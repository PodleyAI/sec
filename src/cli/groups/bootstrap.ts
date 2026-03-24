/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { withCli } from "@workglow/cli";
import type { Command } from "commander";
import { pipe, type ITask, type IWorkflow } from "workglow";
import { BootstrapDownloadTask } from "../../task/bootstrap/BootstrapDownloadTask";
import { FetchAllCikNamesTask } from "../../task/ciknames/FetchAllCikNamesTask";
import { StoreCikNamesTask } from "../../task/ciknames/StoreCikNamesTask";
import { BootstrapCompanyFactsTask } from "../../task/facts/BootstrapCompanyFactsTask";
import { UpdateAllFormsTask } from "../../task/forms/UpdateAllFormsTask";
import { BootstrapSubmissionsTask } from "../../task/submissions/BootstrapSubmissionsTask";
import { runCommand } from "../runCommand";

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
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (options) => {
      await runCommand(
        async () => {
          const force = options.force ?? false;
          const tasks: ITask[] = [];
          if (!options.skipDownload) {
            tasks.push(
              ...Object.values(BULK_DOWNLOADS).map((config) => new BootstrapDownloadTask(config))
            );
          }

          if (!options.skipIngest) {
            tasks.push(
              new FetchAllCikNamesTask(),
              new StoreCikNamesTask(),
              new BootstrapSubmissionsTask({ force }),
              new BootstrapCompanyFactsTask({ force })
            );
          }

          if (!options.skipForms) {
            tasks.push(new UpdateAllFormsTask({ form: ["D", "C"], force }));
          }

          if (tasks.length > 0) {
            const wf = (pipe as (tasks: ITask[]) => IWorkflow)(tasks);
            await withCli(wf).run();
          }
        },
        { force: options.force }
      );
    });

  bootstrap
    .command("download <type>")
    .description("Download bulk SEC data (submissions, facts, ciks, or all)")
    .action(async (type: string) => {
      await runCommand(async () => {
        if (type === "ciks") {
          const wf = pipe([new FetchAllCikNamesTask(), new StoreCikNamesTask()]);
          await withCli(wf).run();
          return;
        }

        if (type !== "submissions" && type !== "facts" && type !== "all") {
          throw new Error(`Invalid type "${type}". Must be submissions, facts, ciks, or all.`);
        }

        const types: (keyof typeof BULK_DOWNLOADS)[] =
          type === "all" ? ["submissions", "facts"] : [type];

        for (const t of types) {
          const config = BULK_DOWNLOADS[t];
          const task = new BootstrapDownloadTask(config);
          await withCli(task).run();
        }
      });
    });

  bootstrap
    .command("ingest [domain]")
    .description("Ingest pre-downloaded SEC data (submissions, facts, cik-names, or all)")
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (domain: string | undefined, options) => {
      await runCommand(
        async () => {
          const target = domain ?? "all";

          if (target === "cik-names" || target === "all") {
            const wf = pipe([new FetchAllCikNamesTask(), new StoreCikNamesTask()]);
            await withCli(wf).run();
          }

          if (target === "submissions" || target === "all") {
            await withCli(new BootstrapSubmissionsTask({ force: options.force })).run();
          }

          if (target === "facts" || target === "all") {
            await withCli(new BootstrapCompanyFactsTask({ force: options.force })).run();
          }

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
        },
        { force: options.force }
      );
    });
}
