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
import {
  advArchiveFolder,
  advArchiveUrlForPeriod,
  latestAvailableAdvPeriod,
} from "../../task/adv/advArchive";
import { IngestAdvSnapshotTask } from "../../task/adv/IngestAdvSnapshotTask";
import { BootstrapDownloadTask } from "../../task/bootstrap/BootstrapDownloadTask";
import { parseIntOption } from "../GlobalOptions";
import { runWorkflowCli } from "../runWorkflow";
import { getSyncLeaf, registerSyncLeaf, type SyncLeafOptionValues } from "./syncLeaves";

const str = (values: SyncLeafOptionValues, key: string): string | undefined =>
  typeof values[key] === "string" ? (values[key] as string) : undefined;
const num = (values: SyncLeafOptionValues, key: string): number | undefined =>
  typeof values[key] === "number" ? (values[key] as number) : undefined;
const bool = (values: SyncLeafOptionValues, key: string): boolean => values[key] === true;

export function registerSecSyncLeaves(): void {
  if (getSyncLeaf("index") !== undefined) {
    return;
  }

  registerSyncLeaf({
    id: "index",
    description: "Catch up EDGAR's daily indexes, marking the CIKs that filed",
    order: 10,
    inAll: true,
    options: [
      {
        flags: "--from <date>",
        description: "Exclusive catch-up start (YYYY-MM-DD); fetch begins the day after this date",
      },
      {
        flags: "--lookback <n>",
        description: "Completed days to re-fetch (default 3)",
        parse: parseIntOption,
        defaultValue: 3,
      },
    ],
    run: async (values) => {
      await runWorkflowCli([
        new CatchUpDailyIndexTask({
          defaults: { from: str(values, "from"), lookback: num(values, "lookback") ?? 3 },
        }),
      ]);
    },
  });

  registerSyncLeaf({
    id: "submissions",
    description: "Refresh company submissions for the CIKs that filed",
    order: 20,
    inAll: true,
    options: [
      {
        flags: "--force",
        description: "Reprocess submissions, ignoring processed state",
        defaultValue: false,
      },
    ],
    run: async (values) => {
      await runWorkflowCli([
        new UpdateAllSubmissionsTask({ defaults: { force: bool(values, "force") } }),
      ]);
    },
  });

  registerSyncLeaf({
    id: "facts",
    description: "Refresh XBRL company facts for all CIKs",
    order: 30,
    inAll: true,
    options: [
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
    run: async (values) => {
      await runWorkflowCli([
        new UpdateAllCompanyFactsTask({
          defaults: {
            force: bool(values, "force"),
            retryFailed: bool(values, "retryFailed"),
            allCiks: bool(values, "allCiks"),
          },
        }),
      ]);
    },
  });

  registerSyncLeaf({
    id: "documents",
    description: "Convert filing documents to markdown sections",
    order: 40,
    inAll: true,
    options: [
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
          "Convert only this issuer's filings — what you want after fetching one " +
          "issuer, since the unfiltered sweep works newest-first across every filer",
        // Rejected by `parseIntOption` at parse time rather than by the leaf: a
        // mistyped CIK that fell through would convert the newest 500 filings of
        // every filer, which looks like success and is not what was asked.
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
    run: async (values) => {
      const types = str(values, "types");
      await runWorkflowCli([
        new ConvertFilingDocumentsTask({
          defaults: {
            forms: types === undefined ? undefined : types.split(",").map((t) => t.trim()),
            since: str(values, "since"),
            cik: num(values, "cik"),
            force: bool(values, "force"),
            downloadOnly: bool(values, "downloadOnly"),
            limit: num(values, "limit") ?? DEFAULT_CONVERT_LIMIT,
          },
        }),
      ]);
    },
  });

  registerSyncLeaf({
    id: "adv",
    description: "Download and ingest the latest Form ADV archive",
    order: 50,
    inAll: true,
    options: [
      {
        flags: "--period <YYYY-MM>",
        description: "Which monthly archive to take (default: the newest that is published yet)",
      },
      {
        flags: "--force",
        description: "Re-download the archive even when it is unchanged since the last run",
        defaultValue: false,
      },
    ],
    run: async (values) => {
      const period = str(values, "period") ?? latestAvailableAdvPeriod();
      // One folder per period, and the ingest reads only that one. A shared
      // folder would hand this month's ingest every member every other archive
      // had left there, and stamp all of them with this period.
      const folder = advArchiveFolder(period);
      await runWorkflowCli([
        new BootstrapDownloadTask({
          title: `Download ADV ${period}`,
          defaults: {
            url: advArchiveUrlForPeriod(period),
            targetFolder: folder,
            force: bool(values, "force"),
          },
        }),
        new IngestAdvSnapshotTask({
          title: `Ingest ADV ${period}`,
          defaults: { snapshot: period, folder },
        }),
      ]);
    },
  });
}
