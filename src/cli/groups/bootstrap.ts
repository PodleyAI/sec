/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import type { ITask } from "workglow";
import { BootstrapAccessionDocsTask } from "../../task/bootstrap/BootstrapAccessionDocsTask";
import { BootstrapDownloadTask } from "../../task/bootstrap/BootstrapDownloadTask";
import { FetchAllCikNamesTask } from "../../task/ciknames/FetchAllCikNamesTask";
import { BootstrapCompanyFactsTask } from "../../task/facts/BootstrapCompanyFactsTask";
import {
  formsSweepLoop,
  newFormsWorklistTask,
  parseShardOption,
} from "../../task/forms/formsSweep";
import { FetchQuarterlyIndexRangeTask } from "../../task/index/FetchQuarterlyIndexRangeTask";
import { StoreCikLastUpdatedTask } from "../../task/index/StoreCikLastUpdatedTask";
import { BackfillNameHistoryTask } from "../../task/submissions/BackfillNameHistoryTask";
import { BootstrapSubmissionsTask } from "../../task/submissions/BootstrapSubmissionsTask";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

const BULK_DOWNLOADS = {
  submissions: {
    url: "https://www.sec.gov/Archives/edgar/daily-index/bulkdata/submissions.zip",
    targetFolder: "submissions",
  },
  facts: {
    url: "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip",
    targetFolder: "companyfacts",
  },
} as const;

export function addBootstrapCommands(program: Command): void {
  const bootstrap = program
    .command("bootstrap")
    .description("Full bootstrap pipeline — download, ingest, and process SEC data");

  bootstrap
    .option("--skip-download", "Skip the bulk download step", false)
    .option("--skip-ingest", "Skip the ingest step", false)
    .option("--skip-forms", "Skip the forms processing step", false)
    .option(
      "--download-docs",
      "Download accession documents for the ingested submissions via daily Feed tarballs (populates the on-disk doc cache before the forms step)",
      false
    )
    .option("--docs-from <date>", "With --download-docs: earliest filing day to fetch (YYYY-MM-DD)")
    .option("--docs-to <date>", "With --download-docs: latest filing day to fetch (YYYY-MM-DD)")
    .option(
      "--shard <i/N>",
      "Forms step: process only shard i of N (1-based) — run N processes with distinct shards to fan out across cores"
    )
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (options) => {
      if (options.force) {
        console.warn(
          "Note: --force no longer affects form processing. Forms re-run only via version bumps (see 'sec version')."
        );
      }
      await runCommand(
        async () => {
          const force = options.force ?? false;
          const tasks: ITask[] = [];
          if (!options.skipDownload) {
            tasks.push(
              ...Object.values(BULK_DOWNLOADS).map(
                (c) =>
                  new BootstrapDownloadTask({
                    title: `Download ${c.targetFolder}`,
                    defaults: { url: c.url, targetFolder: c.targetFolder, force },
                  })
              )
            );
          }

          if (!options.skipIngest) {
            tasks.push(
              new FetchAllCikNamesTask(),
              new BootstrapSubmissionsTask({ defaults: { force } }),
              new BootstrapCompanyFactsTask({ defaults: { force } })
            );
          }

          // Accession-document download runs after ingest (so the filings it
          // scans exist) and before forms (so the forms step reads documents
          // from the on-disk cache instead of fetching each one over the wire).
          if (options.downloadDocs) {
            tasks.push(
              new BootstrapAccessionDocsTask({
                title: "Download accession documents",
                defaults: { from: options.docsFrom, to: options.docsTo, force },
              })
            );
          }

          // The forms producer is NOT a member of the flat task list: it is the
          // body of the sweep's `while` loop, re-run once per batch. The loop
          // nodes live in the outer workflow, so the CLI renders live
          // per-iteration progress.
          const producer = options.skipForms
            ? undefined
            : newFormsWorklistTask(undefined, parseShardOption(options.shard));

          if (tasks.length > 0 || producer !== undefined) {
            await runWorkflowCli(
              tasks,
              undefined,
              producer === undefined ? undefined : formsSweepLoop(producer)
            );
          }
        },
        { force: options.force }
      );
    });

  bootstrap
    .command("download <type>")
    .description("Download bulk SEC data (submissions, facts, ciks, or all)")
    .option(
      "--force",
      "Re-download and fully overwrite even when the archive is unchanged since the last run",
      false
    )
    .action(async (type: string, options: { force?: boolean }) => {
      await runCommand(async () => {
        if (type === "ciks") {
          await runWorkflowCli([new FetchAllCikNamesTask()]);
          return;
        }

        if (type !== "submissions" && type !== "facts" && type !== "all") {
          throw new Error(`Invalid type "${type}". Must be submissions, facts, ciks, or all.`);
        }

        const types: (keyof typeof BULK_DOWNLOADS)[] =
          type === "all" ? ["submissions", "facts"] : [type];

        await runWorkflowCli(
          types.map((t) => {
            const config = BULK_DOWNLOADS[t];
            return new BootstrapDownloadTask({
              title: `Download ${config.targetFolder}`,
              defaults: {
                url: config.url,
                targetFolder: config.targetFolder,
                force: options.force ?? false,
              },
            });
          })
        );
      });
    });

  bootstrap
    .command("quarterly-index <startYear> [startQuarter] [endYear] [endQuarter]")
    .description(
      "Seed cik_last_update from EDGAR quarterly master indexes — the watermark `update submissions` / `update facts` select on"
    )
    .action(
      async (
        startYear: string,
        startQuarter: string | undefined,
        endYear: string | undefined,
        endQuarter: string | undefined
      ) => {
        await runCommand(async () => {
          const num = (label: string, raw: string | undefined, lo: number, hi: number) => {
            if (raw === undefined) return undefined;
            const n = Number(raw);
            if (!Number.isInteger(n) || n < lo || n > hi) {
              throw new Error(`Invalid ${label} "${raw}": expected an integer in ${lo}..${hi}.`);
            }
            return n;
          };
          // Bound the year at the current one rather than an open range: a
          // typo'd 2206 would otherwise sweep 180 quarters of 404s against the
          // rate limiter before anyone noticed.
          const thisYear = new Date().getFullYear();
          const defaults = {
            startYear: num("start year", startYear, 1993, thisYear)!,
            startQuarter: num("start quarter", startQuarter, 1, 4),
            endYear: num("end year", endYear, 1993, thisYear),
            endQuarter: num("end quarter", endQuarter, 1, 4),
          };

          // The range task only EMITS the (cik, last_filing_date) pairs; the
          // store task is what persists them. They are separate tasks because
          // the daily-index path in `sync` reuses the same writer, so the two
          // index cadences cannot drift on how the watermark is written.
          await runWorkflowCli([
            new FetchQuarterlyIndexRangeTask({ defaults }),
            new StoreCikLastUpdatedTask(),
          ]);
        });
      }
    );

  bootstrap
    .command("name-history")
    .description(
      "Repair pass: backfill entities_history from the cached submissions' formerNames, so a renamed company keeps the name it filed under. Ingest writes these rows as it goes, so this is only needed for data ingested before that landed"
    )
    .action(async () => {
      await runCommand(async () => {
        await runWorkflowCli([new BackfillNameHistoryTask()]);
      });
    });

  bootstrap
    .command("download-docs")
    .description(
      "Download accession documents for ingested submissions via daily Feed tarballs (YYYYMMDD.nc.tar.gz)"
    )
    .option("--from <date>", "Earliest filing day to fetch (YYYY-MM-DD)")
    .option("--to <date>", "Latest filing day to fetch (YYYY-MM-DD)")
    .option("--force", "Re-download days already completed and overwrite cached documents", false)
    .action(async (_options, command) => {
      // Merge ancestor options: the parent `bootstrap` command also declares
      // `--force`, and commander attributes a shared flag to the parent, so the
      // subcommand's own `options.force` would stay false. optsWithGlobals()
      // reads the flag wherever commander parked it.
      const options = command.optsWithGlobals();
      await runCommand(
        async () => {
          await runWorkflowCli([
            new BootstrapAccessionDocsTask({
              defaults: { from: options.from, to: options.to, force: options.force === true },
            }),
          ]);
        },
        { force: options.force === true }
      );
    });

  bootstrap
    .command("ingest [domain]")
    .description("Ingest pre-downloaded SEC data (submissions, facts, cik-names, or all)")
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (domain: string | undefined, options) => {
      await runCommand(
        async () => {
          const target = domain ?? "all";

          if (
            target !== "all" &&
            target !== "submissions" &&
            target !== "facts" &&
            target !== "cik-names"
          ) {
            throw new Error(
              `Invalid domain "${target}". Must be submissions, facts, cik-names, or all.`
            );
          }

          const tasks: ITask[] = [];

          if (target === "cik-names" || target === "all") {
            tasks.push(new FetchAllCikNamesTask());
          }

          if (target === "submissions" || target === "all") {
            tasks.push(new BootstrapSubmissionsTask({ defaults: { force: options.force } }));
          }

          if (target === "facts" || target === "all") {
            tasks.push(new BootstrapCompanyFactsTask({ defaults: { force: options.force } }));
          }

          await runWorkflowCli(tasks);
        },
        { force: options.force }
      );
    });
}
