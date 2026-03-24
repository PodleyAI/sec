import { withCli } from "@workglow/cli";
import type { Command } from "commander";
import { pipe } from "workglow";
import { UpdateAllCompanyFactsTask } from "../../task/facts/UpdateAllCompanyFactsTask";
import { UpdateAllFormsTask } from "../../task/forms/UpdateAllFormsTask";
import { FetchDailyIndexTask } from "../../task/index/FetchDailyIndexTask";
import { StoreCikLastUpdatedTask } from "../../task/index/StoreCikLastUpdatedTask";
import { UpdateAllSubmissionsTask } from "../../task/submissions/UpdateAllSubmissionsTask";
import { runCommand } from "../runCommand";

export function addSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("Daily sync — fetch index, update submissions, facts, and forms")
    .option("--forms <types>", "Comma-separated form types to process", "D,C,1-A,1-K,1-Z")
    .option("--force", "Reprocess all items, ignoring processed state", false)
    .action(async (options) => {
      await runCommand(
        async () => {
          const indexFlow = pipe([new FetchDailyIndexTask({}), new StoreCikLastUpdatedTask()]);
          await withCli(indexFlow).run();

          await withCli(new UpdateAllSubmissionsTask({ force: options.force })).run();
          await withCli(new UpdateAllCompanyFactsTask({ force: options.force })).run();

          const formTypes = (options.forms as string).split(",");
          await withCli(new UpdateAllFormsTask({ form: formTypes, force: options.force })).run();
        },
        { force: options.force }
      );
    });
}
