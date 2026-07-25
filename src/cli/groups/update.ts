import type { Command } from "commander";
import { UpdateAllCompanyFactsTask } from "../../task/facts/UpdateAllCompanyFactsTask";
import {
  formsSweepLoop,
  newFormsWorklistTask,
  parseShardOption,
} from "../../task/forms/formsSweep";
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
    .option(
      "--shard <i/N>",
      "Process only shard i of N (1-based) — run N processes with distinct shards to fan out across cores"
    )
    .action(async (types: string, options: { shard?: string }) => {
      await runCommand(async () => {
        const formTypes = types.split(",");
        const shard = parseShardOption(options.shard);
        // The producer is the sweep loop's body, not a task ahead of it.
        await runWorkflowCli([], undefined, formsSweepLoop(newFormsWorklistTask(formTypes, shard)));
      });
    });
}
