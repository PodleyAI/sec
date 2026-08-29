/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { reportSpacProcessRows, spacProcessFailureCount } from "../../commands/spac";
import { UpdateAllCompanyFactsTask } from "../../task/facts/UpdateAllCompanyFactsTask";
import { CatchUpDailyIndexTask } from "../../task/index/CatchUpDailyIndexTask";
import {
  ConvertFilingDocumentsTask,
  DEFAULT_CONVERT_LIMIT,
} from "../../task/document/ConvertFilingDocumentsTask";
import { IdentifySpacsTask } from "../../task/spac/IdentifySpacsTask";
import { ProcessSpacTimelineTask } from "../../task/spac/ProcessSpacTimelineTask";
import { UpdateAllSubmissionsTask } from "../../task/submissions/UpdateAllSubmissionsTask";
import { parseIntOption } from "../GlobalOptions";
import { isDryRun } from "../isDryRun";
import { runWorkflowCli } from "../runWorkflow";
import { runFormsSweep } from "./runFormsSweep";
import {
  DEFAULT_SPAC_ISSUER_CONCURRENCY,
  runSpacTimelineIssuers,
  spacProcessRows,
  type SpacProcessColumns,
} from "./runSpacTimelineIssuers";
import {
  filterSpacCiksByHistory,
  listSpacProcessCiks,
  parseSpacProcessOnly,
  shardCiks,
  spacUpdatesFiledOnOrAfter,
  type SpacProcessOnly,
} from "./spacSyncCiks";
import { SYNC_FORM_DOMAINS, expandFormTypes, formsForExtractorIds } from "./syncFormDomains";
import {
  getSyncLeaf,
  registerSyncLeaf,
  SHARD_LEAF_OPTION,
  type SyncLeafOptionValues,
  type SyncRunContext,
} from "./syncLeaves";

/**
 * `sync spacs`'s own options — the ones no other leaf and no shared context
 * field knows about.
 */
interface SpacSyncOptions {
  /** Restrict the process step's CIKs. Undefined means both kinds. */
  readonly only: SpacProcessOnly | undefined;
  /** How many SPAC issuers to replay at once. Filings within an issuer stay serial. */
  readonly concurrency: number;
}

/**
 * Validates `--only` wherever its value came from: commander parsing the flag,
 * or {@link spacSyncOptions} reading back what a command already parsed.
 */
function spacProcessOnly(value: unknown): SpacProcessOnly | undefined {
  return typeof value === "string" ? parseSpacProcessOnly(value) : undefined;
}

/**
 * Reads the leaf's options off what its command parsed. `values` is absent
 * when no `sync spacs` command stands behind the run — `sync all`, or a caller
 * invoking a step directly — and every option falls back to its own default,
 * which is what those callers got when these two lived on the shared context.
 */
function spacSyncOptions(values: SyncLeafOptionValues | undefined): SpacSyncOptions {
  const concurrency = values?.concurrency;
  return {
    only: spacProcessOnly(values?.only),
    concurrency: Math.max(
      1,
      typeof concurrency === "number" ? concurrency : DEFAULT_SPAC_ISSUER_CONCURRENCY
    ),
  };
}

export function registerSecSyncLeaves(): void {
  if (getSyncLeaf("submissions") !== undefined) {
    return;
  }

  registerSyncLeaf({
    id: "submissions",
    description: "Catch up daily indexes and refresh submissions",
    order: 10,
    inAll: true,
    options: {
      declare: [
        {
          flags: "--force",
          description: "Reprocess submissions, ignoring processed state",
          defaultValue: false,
        },
        {
          flags: "--from <date>",
          description:
            "Exclusive catch-up start (YYYY-MM-DD); fetch begins the day after this date",
        },
        {
          flags: "--lookback <n>",
          description: "Completed days to re-fetch (default 3)",
          parse: parseIntOption,
          defaultValue: 3,
        },
      ],
    },
    steps: [
      {
        id: "index",
        title: "Catch up daily indexes",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([
            new CatchUpDailyIndexTask({
              defaults: { from: ctx.from, lookback: ctx.lookback },
            }),
          ]);
        },
      },
      {
        id: "submissions",
        title: "Update submissions for all CIKs",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([new UpdateAllSubmissionsTask({ defaults: { force: ctx.force } })]);
        },
      },
    ],
    runAll: async (ctx: SyncRunContext) => {
      await runWorkflowCli([
        new CatchUpDailyIndexTask({ defaults: { from: ctx.from, lookback: ctx.lookback } }),
        new UpdateAllSubmissionsTask({ defaults: { force: ctx.force } }),
      ]);
    },
  });

  registerSyncLeaf({
    id: "facts",
    description: "Refresh company facts for all CIKs",
    order: 20,
    inAll: true,
    options: {
      declare: [
        {
          flags: "--force",
          description: "Reprocess all items, ignoring processed state",
          defaultValue: false,
        },
        {
          flags: "--retry-failed",
          description: "Also re-fetch CIKs whose last facts processing failed",
          defaultValue: false,
        },
      ],
    },
    steps: [
      {
        id: "facts",
        title: "Update company facts",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([
            new UpdateAllCompanyFactsTask({
              defaults: { force: ctx.force, retryFailed: ctx.retryFailed },
            }),
          ]);
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "portals",
    description: "Process CFPORTAL registration forms",
    order: 30,
    inAll: true,
    options: { declare: [SHARD_LEAF_OPTION] },
    steps: [
      {
        id: "portals",
        title: "Process portal forms",
        run: async (ctx: SyncRunContext) => {
          await runFormsSweep({
            formTypes: formsForExtractorIds([...SYNC_FORM_DOMAINS.portals]),
            shard: ctx.shard,
            requestedFrom: "sync domain 'portals'",
          });
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "crowdfunding",
    description: "Process Form C family filings",
    order: 40,
    inAll: true,
    options: { declare: [SHARD_LEAF_OPTION] },
    steps: [
      {
        id: "crowdfunding",
        title: "Process crowdfunding forms",
        run: async (ctx: SyncRunContext) => {
          await runFormsSweep({
            formTypes: formsForExtractorIds([...SYNC_FORM_DOMAINS.crowdfunding]),
            shard: ctx.shard,
            requestedFrom: "sync domain 'crowdfunding'",
          });
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "reg-a",
    description: "Process Reg A family filings",
    order: 50,
    inAll: true,
    options: { declare: [SHARD_LEAF_OPTION] },
    steps: [
      {
        id: "reg-a",
        title: "Process Reg A forms",
        run: async (ctx: SyncRunContext) => {
          await runFormsSweep({
            formTypes: formsForExtractorIds([...SYNC_FORM_DOMAINS["reg-a"]]),
            shard: ctx.shard,
            requestedFrom: "sync domain 'reg-a'",
          });
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "forms",
    description: "Process specific form types (comma-separated)",
    order: 55,
    inAll: false,
    options: { declare: [SHARD_LEAF_OPTION] },
    steps: [
      {
        id: "forms",
        title: "Process forms",
        run: async (ctx: SyncRunContext) => {
          if (!ctx.formTypes?.length) {
            throw new Error("sync forms requires a comma-separated type list");
          }
          await runFormsSweep({
            formTypes: expandFormTypes(ctx.formTypes),
            shard: ctx.shard,
            requestedFrom: `tokens '${ctx.formTypes.join(",")}'`,
          });
        },
      },
    ],
  });

  registerSyncLeaf({
    id: "spacs",
    description: "Identify SPAC candidates and process SPAC filings",
    order: 60,
    inAll: true,
    options: {
      declare: [
        {
          flags: "--full",
          description:
            "Rescan every entity instead of only those whose submissions changed since the last run",
          defaultValue: false,
        },
        SHARD_LEAF_OPTION,
        {
          flags: "--only <kind>",
          description:
            "never-processed = SPACs with no successful run yet; updates = already-processed SPACs, filings since the last SPAC process run (default: both, including historical leftover)",
          parse: spacProcessOnly,
        },
        {
          flags: "-c, --concurrency <n>",
          description:
            "How many ISSUERS to process at once (default 3). Filings within an issuer are always serial.",
          parse: parseIntOption,
          defaultValue: DEFAULT_SPAC_ISSUER_CONCURRENCY,
        },
      ],
      readContext: (values) => ({ full: values.full === true }),
    },
    steps: [
      {
        id: "identify",
        title: "Identify SPAC candidates",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([new IdentifySpacsTask({ defaults: { full: ctx.full } })]);
        },
      },
      {
        id: "process",
        title: "Process SPAC filings",
        run: async (ctx: SyncRunContext, values?: SyncLeafOptionValues) => {
          const { only, concurrency } = spacSyncOptions(values);
          const processCiks = shardCiks(
            await filterSpacCiksByHistory(await listSpacProcessCiks(), only),
            ctx.shard
          );
          if (processCiks.length === 0) {
            if (only === "never-processed") {
              console.log("No never-processed SPACs");
            } else if (only === "updates") {
              console.log("No previously processed SPACs");
            } else {
              console.log("No known SPACs or high/medium candidates");
            }
            return;
          }
          const filedOnOrAfter = only === "updates" ? await spacUpdatesFiledOnOrAfter() : undefined;
          const rows = await runSpacTimelineIssuers({
            ciks: processCiks,
            concurrency,
            filedOnOrAfter,
          });
          reportSpacProcessRows(rows, { dryRun: isDryRun() });
          const failed = spacProcessFailureCount(rows);
          if (failed > 0) {
            throw new Error(`${failed} of ${processCiks.length} issuer(s) had failed filings`);
          }
        },
      },
    ],
    runAll: async (ctx: SyncRunContext, values?: SyncLeafOptionValues) => {
      const { only, concurrency } = spacSyncOptions(values);
      const filedOnOrAfter = only === "updates" ? await spacUpdatesFiledOnOrAfter() : undefined;
      const { failed, total } = await runWorkflowCli<{ failed: number; total: number }>(
        [new IdentifySpacsTask({ defaults: { full: ctx.full } })],
        undefined,
        (wf) => {
          wf.pipe(async () => ({
            cik: shardCiks(
              await filterSpacCiksByHistory(await listSpacProcessCiks(), only),
              ctx.shard
            ),
          }));
          // The map's dynamic loop-body schema only auto-connects by name/type
          // (not the blanket wildcard a plain `pipe()` edge uses), and a
          // pipe-function task only ever declares a literal `"*"` output
          // property — so it can never match the loop's `cik` input by name.
          // `.rename("*", "*")` queues the same wildcard dataflow `pipe()`
          // would have used, bypassing that name match entirely.
          wf.rename("*", "*");
          const loop = wf.map({
            concurrencyLimit: concurrency,
            maxIterations: "unbounded",
            preserveOrder: true,
          });
          loop.pipe(
            new ProcessSpacTimelineTask({
              defaults: filedOnOrAfter !== undefined ? { filedOnOrAfter } : {},
            })
          );
          loop.endMap();
          wf.pipe((columns: SpacProcessColumns) => {
            const rows = spacProcessRows(columns);
            if (rows.length === 0) {
              if (only === "never-processed") {
                console.log("No never-processed SPACs");
              } else if (only === "updates") {
                console.log("No previously processed SPACs");
              } else {
                console.log("No known SPACs or high/medium candidates");
              }
              return { failed: 0, total: 0 };
            }
            reportSpacProcessRows(rows, { dryRun: isDryRun() });
            return { failed: spacProcessFailureCount(rows), total: rows.length };
          });
        }
      );
      // Kept outside the graph: `runWorkflowCli`'s contract is that only
      // unexpected failures should throw from inside it, since a TTY run
      // intercepts a thrown error with `process.exit(1)`, bypassing normal
      // command error handling. A nonzero failure count is an expected,
      // reportable outcome, not a crash.
      if (failed > 0) {
        throw new Error(`${failed} of ${total} issuer(s) had failed filings`);
      }
    },
  });

  registerSyncLeaf({
    id: "documents",
    description: "Convert filing documents to markdown sections",
    order: 70,
    inAll: true,
    options: {
      declare: [
        {
          flags: "--types <list>",
          description:
            "Comma-separated forms to convert (default: the narrative set in CONVERTIBLE_FORMS)",
        },
        {
          flags: "--since <date>",
          description: "Only filings filed on or after this date (YYYY-MM-DD)",
        },
        {
          flags: "--cik <cik>",
          description:
            "Convert only this issuer's filings — what you want after `spac process <cik>`, " +
            "since the unfiltered sweep works newest-first across every filer",
          // Rejected by `parseIntOption` at parse time rather than by the leaf:
          // a mistyped CIK that fell through would convert the newest 500
          // filings of every filer, which looks like success and is not what
          // was asked.
          parse: parseIntOption,
        },
        {
          flags: "--limit <n>",
          description:
            "How many filings to convert in this run (default 500) — a backfill is many runs",
          parse: parseIntOption,
        },
        {
          flags: "--all-8k",
          description:
            "Convert 8-Ks from every filer, not just CIKs in the spac table — the default " +
            "skips them because every reporting company files them",
          defaultValue: false,
        },
        {
          flags: "--download-only",
          description:
            "Fetch each selected filing into the accession-doc cache and stop — no parsing, " +
            "no rows written; re-running converts them with no further requests",
          defaultValue: false,
        },
        {
          flags: "--force",
          description: "Re-convert filings already stored at the current converter version",
          defaultValue: false,
        },
      ],
      readContext: (values) => ({
        // `sync forms --types` already means "narrow to these forms"; reusing
        // it here keeps one vocabulary rather than inventing a second spelling
        // of the same idea.
        formTypes: typeof values.types === "string" ? values.types.split(",") : undefined,
        from: typeof values.since === "string" ? values.since : undefined,
        cik: typeof values.cik === "number" ? values.cik : undefined,
        limit: typeof values.limit === "number" ? values.limit : undefined,
        all8k: values.all8k === true,
        downloadOnly: values.downloadOnly === true,
      }),
    },
    steps: [
      {
        id: "convert",
        title: "Convert filings to markdown",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([
            new ConvertFilingDocumentsTask({
              defaults: {
                forms: ctx.formTypes?.length ? expandFormTypes(ctx.formTypes) : undefined,
                since: ctx.from,
                cik: ctx.cik,
                force: ctx.force,
                all8k: ctx.all8k,
                downloadOnly: ctx.downloadOnly,
                limit: ctx.limit ?? DEFAULT_CONVERT_LIMIT,
              },
            }),
          ]);
        },
      },
    ],
  });
}
