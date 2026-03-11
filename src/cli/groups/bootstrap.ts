import { runTasks, runWorkflow } from "@workglow/cli";
import { pipe } from "@workglow/task-graph";
import type { Command } from "commander";
import { BootstrapDownloadTask } from "../../task/bootstrap/BootstrapDownloadTask";
import { BootstrapSubmissionsTask } from "../../task/submissions/BootstrapSubmissionsTask";
import { BootstrapCompanyFactsTask } from "../../task/facts/BootstrapCompanyFactsTask";
import { FetchAllCikNamesTask } from "../../task/ciknames/FetchAllCikNamesTask";
import { StoreCikNamesTask } from "../../task/ciknames/StoreCikNamesTask";
import { UpdateAllFormsTask } from "../../task/forms/UpdateAllFormsTask";
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
      await runCommand(async () => {
        if (!options.skipDownload) {
          for (const config of Object.values(BULK_DOWNLOADS)) {
            const task = new BootstrapDownloadTask(config);
            await runTasks(task);
          }
        }

        if (!options.skipIngest) {
          const cikWf = pipe([new FetchAllCikNamesTask(), new StoreCikNamesTask()]);
          await runWorkflow(cikWf);
          await runTasks(new BootstrapSubmissionsTask({ force: options.force }));
          await runTasks(new BootstrapCompanyFactsTask({ force: options.force }));
        }

        if (!options.skipForms) {
          await runTasks(new UpdateAllFormsTask({ form: ["D", "C"], force: options.force }));
        }
      });
    });

  bootstrap
    .command("download <type>")
    .description("Download bulk SEC data (submissions, facts, ciks, or all)")
    .action(async (type: string) => {
      await runCommand(async () => {
        if (type === "ciks") {
          const wf = pipe([new FetchAllCikNamesTask(), new StoreCikNamesTask()]);
          await runWorkflow(wf);
          return;
        }

        if (type !== "submissions" && type !== "facts" && type !== "all") {
          throw new Error(
            `Invalid type "${type}". Must be submissions, facts, ciks, or all.`
          );
        }

        const types: (keyof typeof BULK_DOWNLOADS)[] =
          type === "all" ? ["submissions", "facts"] : [type];

        for (const t of types) {
          const config = BULK_DOWNLOADS[t];
          const task = new BootstrapDownloadTask(config);
          await runTasks(task);
        }
      });
    });

  bootstrap
    .command("ingest [domain]")
    .description("Ingest pre-downloaded SEC data (submissions, facts, cik-names, or all)")
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (domain: string | undefined, options) => {
      await runCommand(async () => {
        const target = domain ?? "all";

        if (target === "cik-names" || target === "all") {
          const wf = pipe([new FetchAllCikNamesTask(), new StoreCikNamesTask()]);
          await runWorkflow(wf);
        }

        if (target === "submissions" || target === "all") {
          await runTasks(new BootstrapSubmissionsTask({ force: options.force }));
        }

        if (target === "facts" || target === "all") {
          await runTasks(new BootstrapCompanyFactsTask({ force: options.force }));
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
      });
    });
}
