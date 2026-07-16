import type { Command } from "commander";
import { UpdateAllCompanyFactsTask } from "../../task/facts/UpdateAllCompanyFactsTask";
import { UpdateAllFormsTask } from "../../task/forms/UpdateAllFormsTask";
import { UpdateAllSubmissionsTask } from "../../task/submissions/UpdateAllSubmissionsTask";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

export function addUpdateCommands(program: Command): void {
  const update = program.command("update").description("Update all data for a given domain");

  update
    .command("submissions")
    .description("Update all submissions for all companies")
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (options) => {
      await runCommand(
        async () => {
          await runWorkflowCli([
            new UpdateAllSubmissionsTask({ defaults: { force: options.force } }),
          ]);
        },
        { force: options.force }
      );
    });

  update
    .command("facts")
    .description("Update all company facts")
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .option("--retry-failed", "Also re-fetch CIKs whose last facts processing failed", false)
    .action(async (options) => {
      await runCommand(
        async () => {
          await runWorkflowCli([
            new UpdateAllCompanyFactsTask({
              defaults: { force: options.force, retryFailed: options.retryFailed },
            }),
          ]);
        },
        { force: options.force }
      );
    });

  update
    .command("forms <types>")
    .description("Update forms for all companies (comma-separated form types)")
    .action(async (types: string) => {
      await runCommand(async () => {
        const formTypes = types.split(",");
        await runWorkflowCli([new UpdateAllFormsTask({ defaults: { form: formTypes } })]);
      });
    });
}
