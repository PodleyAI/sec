import type { Command } from "commander";
import { UpdateAllCompanyFactsTask } from "../../task/facts/UpdateAllCompanyFactsTask";
import { UpdateAllFormsTask } from "../../task/forms/UpdateAllFormsTask";
import { FetchDailyIndexTask } from "../../task/index/FetchDailyIndexTask";
import { StoreCikLastUpdatedTask } from "../../task/index/StoreCikLastUpdatedTask";
import { UpdateAllSubmissionsTask } from "../../task/submissions/UpdateAllSubmissionsTask";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";

export function addSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Daily sync — fetch index, update submissions, facts, and forms")
    .option(
      "--forms <types>",
      "Comma-separated form types to process (default: every form with a registered extractor)"
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
          const formTypes =
            options.forms !== undefined ? (options.forms as string).split(",") : undefined;
          await runWorkflowCli([
            new FetchDailyIndexTask(),
            new StoreCikLastUpdatedTask(),
            new UpdateAllSubmissionsTask({ defaults: { force: options.force } }),
            new UpdateAllCompanyFactsTask({ defaults: { force: options.force } }),
            new UpdateAllFormsTask({ defaults: { form: formTypes } }),
          ]);
        },
        { force: options.force }
      );
    });
}
