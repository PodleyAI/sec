/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";
import { isDryRun } from "../isDryRun";
import { RetryDeadLettersTask } from "../../task/forms/RetryDeadLettersTask";
import { BackfillExtractorTask } from "../../task/forms/BackfillExtractorTask";
import {
  ListDeadLettersTask,
  type ListDeadLettersTaskOutput,
} from "../../task/forms/ListDeadLettersTask";
import { listBackfillableExtractorIds } from "../../task/forms/backfillDescriptors";

// The count lives with ListDeadLettersTask (single source for the eligibility
// wiring); re-exported here for the version group and its tests.
export { countEligibleDeadLetters } from "../../task/forms/ListDeadLettersTask";

export function addExtractorCommands(program: Command): void {
  const cmd = program
    .command("extractor")
    .description("Extractor dead-letters and generalized backfill");

  cmd
    .command("dead-letters <extractorId>")
    .description("List dead-letter entries for an extractor")
    .option("--eligible", "only show the count eligible for retry under the current version", false)
    .action(async (extractorId: string, opts: { eligible: boolean }) => {
      await runCommand(async () => {
        const { pending, eligibleCount } = await runWorkflowCli<ListDeadLettersTaskOutput>([
          new ListDeadLettersTask({
            defaults: { extractorId, eligible: opts.eligible === true },
          }),
        ]);
        if (opts.eligible) {
          const n = eligibleCount ?? 0;
          console.log(`${n} dead-letter entr${n === 1 ? "y" : "ies"} eligible for retry`);
          return;
        }
        for (const e of pending) {
          console.log(
            `${e.accession_number}\t${e.section_name || "(filing)"}\t${e.reason_code}\t` +
              `v${e.failed_extractor_version}\tattempts=${e.attempts}`
          );
        }
        console.log(`${pending.length} pending`);
      });
    });

  cmd
    .command("backfill <extractorId>")
    .description(
      "Re-process the extractor's candidate filings that lack a successful run at the " +
        `active version (ids: ${listBackfillableExtractorIds().join(", ")})`
    )
    .option("--force", "Re-process candidates even when a successful run already exists", false)
    .option("--dry-run", "Report selected/skipped counts without reprocessing", false)
    .action(async (extractorId: string, opts: { force?: boolean; dryRun?: boolean }) => {
      await runCommand(async () => {
        const out = await runWorkflowCli<{
          selected: number;
          processed: number;
          skipped: number;
        }>([
          new BackfillExtractorTask({
            defaults: {
              extractorId,
              force: opts.force === true,
              // Commander resolves `--dry-run` against the program-level global
              // option, so merge both sources.
              dryRun: opts.dryRun === true || isDryRun(),
            },
          }),
        ]);
        console.log(
          `selected ${out.selected} filing(s); processed ${out.processed}; skipped ${out.skipped}`
        );
      });
    });

  cmd
    .command("retry-dead-letters <extractorId>")
    .description("Re-run filings whose dead-letter entries are eligible under the current version")
    .action(async (extractorId: string) => {
      await runCommand(async () => {
        const out = await runWorkflowCli<{
          eligibleAccessions: string[];
          reprocessed: number;
          failed: number;
        }>([new RetryDeadLettersTask({ defaults: { extractorId } })]);
        const failedSuffix = out.failed > 0 ? `, ${out.failed} failed` : "";
        console.log(
          `reprocessed ${out.reprocessed} filing(s) from ${out.eligibleAccessions.length} eligible${failedSuffix}`
        );
      });
    });
}
