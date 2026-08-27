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
import { isDryRun } from "../isDryRun";
import { runWorkflowCli } from "../runWorkflow";
import { runFormsSweep } from "./runFormsSweep";
import {
  runSpacTimelineIssuers,
  spacProcessRows,
  type SpacProcessColumns,
} from "./runSpacTimelineIssuers";
import {
  filterSpacCiksByHistory,
  listSpacProcessCiks,
  shardCiks,
  spacUpdatesFiledOnOrAfter,
} from "./spacSyncCiks";
import { SYNC_FORM_DOMAINS, expandFormTypes, formsForExtractorIds } from "./syncFormDomains";
import { getSyncLeaf, registerSyncLeaf, type SyncRunContext } from "./syncLeaves";

export function registerSecSyncLeaves(): void {
  if (getSyncLeaf("submissions") !== undefined) {
    return;
  }

  registerSyncLeaf({
    id: "submissions",
    description: "Catch up daily indexes and refresh submissions",
    order: 10,
    inAll: true,
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
        run: async (ctx: SyncRunContext) => {
          const processCiks = shardCiks(
            await filterSpacCiksByHistory(await listSpacProcessCiks(), ctx.only),
            ctx.shard
          );
          if (processCiks.length === 0) {
            if (ctx.only === "never-processed") {
              console.log("No never-processed SPACs");
            } else if (ctx.only === "updates") {
              console.log("No previously processed SPACs");
            } else {
              console.log("No known SPACs or high/medium candidates");
            }
            return;
          }
          const filedOnOrAfter =
            ctx.only === "updates" ? await spacUpdatesFiledOnOrAfter() : undefined;
          const rows = await runSpacTimelineIssuers({
            ciks: processCiks,
            concurrency: ctx.concurrency,
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
    runAll: async (ctx: SyncRunContext) => {
      const filedOnOrAfter = ctx.only === "updates" ? await spacUpdatesFiledOnOrAfter() : undefined;
      const { failed, total } = await runWorkflowCli<{ failed: number; total: number }>(
        [new IdentifySpacsTask({ defaults: { full: ctx.full } })],
        undefined,
        (wf) => {
          wf.pipe(async () => ({
            cik: shardCiks(
              await filterSpacCiksByHistory(await listSpacProcessCiks(), ctx.only),
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
            concurrencyLimit: Math.max(1, ctx.concurrency),
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
              if (ctx.only === "never-processed") {
                console.log("No never-processed SPACs");
              } else if (ctx.only === "updates") {
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
    steps: [
      {
        id: "convert",
        title: "Convert filings to markdown",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([
            new ConvertFilingDocumentsTask({
              defaults: {
                // `sync forms --types` already means "narrow to these forms";
                // reusing it here keeps one vocabulary rather than inventing a
                // second spelling of the same idea.
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
