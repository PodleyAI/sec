import { runTasks } from "@workglow/cli";
import type { Command } from "commander";
import { UpdateAllSubmissionsTask } from "../../task/submissions/UpdateAllSubmissionsTask";
import { UpdateAllCompanyFactsTask } from "../../task/facts/UpdateAllCompanyFactsTask";
import { UpdateAllFormsTask } from "../../task/forms/UpdateAllFormsTask";
import { runCommand } from "../runCommand";

export function addUpdateCommands(program: Command): void {
  const update = program
    .command("update")
    .description("Update all data for a given domain");

  update
    .command("submissions")
    .description("Update all submissions for all companies")
    .option("--concurrency <n>", "Override default concurrency")
    .action(async () => {
      await runCommand(async () => {
        await runTasks(new UpdateAllSubmissionsTask());
      });
    });

  update
    .command("facts")
    .description("Update all company facts")
    .option("--concurrency <n>", "Override default concurrency")
    .action(async () => {
      await runCommand(async () => {
        await runTasks(new UpdateAllCompanyFactsTask());
      });
    });

  update
    .command("forms <types>")
    .description("Update forms for all companies (comma-separated form types)")
    .option("--concurrency <n>", "Override default concurrency")
    .action(async (types: string) => {
      await runCommand(async () => {
        const formTypes = types.split(",");
        await runTasks(new UpdateAllFormsTask({ form: formTypes }));
      });
    });
}
