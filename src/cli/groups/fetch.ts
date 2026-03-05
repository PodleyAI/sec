import { runTasks, runWorkflow } from "@workglow/cli";
import { Workflow } from "@workglow/task-graph";
import type { Command } from "commander";
import { FetchSubmissionsTask } from "../../task/submissions/FetchSubmissionsTask";
import { StoreSubmissionsTask } from "../../task/submissions/StoreSubmissionsTask";
import { FetchCompanyFactsTask } from "../../task/facts/FetchCompanyFactsTask";
import { StoreCompanyFactsTask } from "../../task/facts/StoreCompanyFactsTask";
import { FetchAndStoreFormsTask } from "../../task/forms/FetchAndStoreFormsTask";
import { ProcessAccessionDocFormTask } from "../../task/forms/ProcessAccessionDocFormTask";
import { secDate } from "../../util/parseDate";
import { runCommand } from "../runCommand";

export function addFetchCommands(program: Command): void {
  const fetch = program
    .command("fetch")
    .description("Fetch data for a single entity");

  fetch
    .command("submissions <cik>")
    .description("Fetch and store submissions for a single company")
    .option("--date <date>", "Cache buster date")
    .action(async (cik: string, options) => {
      await runCommand(async () => {
        const wf = new Workflow();
        wf.pipe(
          new FetchSubmissionsTask({
            cik: parseInt(cik),
            date: options.date ? secDate(options.date) : undefined,
          }),
          new StoreSubmissionsTask()
        );
        await runWorkflow(wf);
      });
    });

  fetch
    .command("facts <cik>")
    .description("Fetch and store company facts for a single company")
    .option("--date <date>", "Cache buster date")
    .action(async (cik: string, options) => {
      await runCommand(async () => {
        const wf = new Workflow();
        wf.pipe(
          new FetchCompanyFactsTask({
            cik: parseInt(cik),
            date: options.date ? secDate(options.date) : undefined,
          }),
          new StoreCompanyFactsTask()
        );
        await runWorkflow(wf);
      });
    });

  fetch
    .command("form <cik> <form> [accession]")
    .description("Fetch and store a specific form for a company")
    .action(async (cik: string, form: string, accession?: string) => {
      await runCommand(async () => {
        const task = new FetchAndStoreFormsTask({
          cik: parseInt(cik),
          form,
          docid: accession,
        });
        await runTasks(task);
      });
    });

  fetch
    .command("doc <accession> [filename]")
    .description("Process a specific accession document")
    .action(async (accession: string, filename?: string) => {
      await runCommand(async () => {
        const task = new ProcessAccessionDocFormTask({
          accessionNumber: accession,
          fileName: filename,
        });
        await runTasks(task);
      });
    });
}
