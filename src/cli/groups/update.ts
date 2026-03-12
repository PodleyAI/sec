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
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (options) => {
      await runCommand(
        async () => {
          await runTasks(new UpdateAllSubmissionsTask({ force: options.force }));
        },
        { force: options.force }
      );
    });

  update
    .command("facts")
    .description("Update all company facts")
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (options) => {
      await runCommand(
        async () => {
          await runTasks(new UpdateAllCompanyFactsTask({ force: options.force }));
        },
        { force: options.force }
      );
    });

  update
    .command("forms <types>")
    .description("Update forms for all companies (comma-separated form types)")
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (types: string, options) => {
      await runCommand(
        async () => {
          const formTypes = types.split(",");
          await runTasks(new UpdateAllFormsTask({ form: formTypes, force: options.force }));
        },
        { force: options.force }
      );
    });
}
