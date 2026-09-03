/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ConvertFilingDocumentsTask,
  DEFAULT_CONVERT_LIMIT,
} from "../../task/document/ConvertFilingDocumentsTask";
import { UpdateAllCompanyFactsTask } from "../../task/facts/UpdateAllCompanyFactsTask";
import { CatchUpDailyIndexTask } from "../../task/index/CatchUpDailyIndexTask";
import { UpdateAllSubmissionsTask } from "../../task/submissions/UpdateAllSubmissionsTask";
import { parseIntOption } from "../GlobalOptions";
import { runWorkflowCli } from "../runWorkflow";
import { runFormsSweep } from "./runFormsSweep";
import { expandFormTypes, formsForExtractorIds, SYNC_FORM_DOMAINS } from "./syncFormDomains";
import {
  getSyncLeaf,
  registerSyncLeaf,
  SHARD_LEAF_OPTION,
  type SyncRunContext,
} from "./syncLeaves";

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
        {
          flags: "--all-ciks",
          description:
            "Fetch never-processed CIKs with no XBRL filing and no SIC too (~14x the work, almost all 404s)",
          defaultValue: false,
        },
      ],
      readContext: (values) => ({
        allCiks: values.allCiks === true,
      }),
    },
    steps: [
      {
        id: "facts",
        title: "Update company facts",
        run: async (ctx: SyncRunContext) => {
          await runWorkflowCli([
            new UpdateAllCompanyFactsTask({
              defaults: {
                force: ctx.force,
                retryFailed: ctx.retryFailed,
                allCiks: ctx.allCiks,
              },
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
            "Convert only this issuer's filings — what you want after processing one " +
            "issuer, since the unfiltered sweep works newest-first across every filer",
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
