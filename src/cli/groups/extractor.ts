/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { runCommand } from "../runCommand";
import { runWorkflowCli } from "../runWorkflow";
import { isDryRun } from "../isDryRun";
import { parseIntOption } from "../GlobalOptions";
import { RetryDeadLettersTask } from "../../task/forms/RetryDeadLettersTask";
import { BackfillExtractorTask } from "../../task/forms/BackfillExtractorTask";
import {
  ListDeadLettersTask,
  type ListDeadLettersTaskOutput,
} from "../../task/forms/ListDeadLettersTask";
import { listBackfillableExtractorIds } from "../../task/forms/backfillDescriptors";
import {
  ReconstructRosterCompletenessTask,
  type ReconstructRosterCompletenessTaskOutput,
} from "../../task/resolve/ReconstructRosterCompletenessTask";

// The count lives with ListDeadLettersTask (single source for the eligibility
// wiring); re-exported here for the version group and its tests.
export { countEligibleDeadLetters } from "../../task/forms/ListDeadLettersTask";

export function addExtractorCommands(program: Command): void {
  const cmd = program
    .command("extractor")
    .description("Extractor dead-letters, generalized backfill, and one-shot repairs");

  cmd
    .command("dead-letters [extractorId]")
    .description("List dead-letter entries for an extractor, or for one issuer with --cik")
    .option(
      "--eligible",
      "count entries eligible for retry under each extractor's current version",
      false
    )
    .option(
      "--cik <cik>",
      "Only entries whose accession belongs to this issuer (joins through filings)",
      parseIntOption
    )
    .action(async (extractorId: string | undefined, opts: { eligible: boolean; cik?: number }) => {
      await runCommand(async () => {
        const id = extractorId === undefined || extractorId === "" ? undefined : extractorId;
        if (id === undefined && opts.cik === undefined) {
          throw new Error("Provide an extractor id or --cik.");
        }
        const { pending, eligibleCount, eligibleByExtractor } =
          await runWorkflowCli<ListDeadLettersTaskOutput>([
            new ListDeadLettersTask({
              defaults: {
                extractorId: id,
                cik: opts.cik,
                eligible: opts.eligible === true,
              },
            }),
          ]);
        if (opts.eligible) {
          if (id === undefined) {
            for (const row of eligibleByExtractor ?? []) {
              console.log(`${row.extractor_id}\t${row.count}`);
            }
          }
          const n = eligibleCount ?? 0;
          console.log(`${n} dead-letter entr${n === 1 ? "y" : "ies"} eligible for retry`);
          return;
        }
        for (const e of pending) {
          const extractorCol = id === undefined ? `${e.extractor_id}\t` : "";
          console.log(
            `${extractorCol}${e.accession_number}\t${e.section_name || "(filing)"}\t${e.reason_code}\t` +
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
          resolved: number;
          failed: number;
        }>([new RetryDeadLettersTask({ defaults: { extractorId } })]);
        const failedSuffix = out.failed > 0 ? `, ${out.failed} failed` : "";
        console.log(
          `reprocessed ${out.reprocessed} filing(s), resolved ${out.resolved} expected-negative ` +
            `entr(ies) from ${out.eligibleAccessions.length} eligible${failedSuffix}`
        );
      });
    });

  // A leaf an operator types once, deliberately, and not a step of any sweep.
  // It belongs beside `backfill` because that is the alternative: both restore
  // the same decisions, and this one restores the half that is recoverable
  // without paying a model to read the filings again. It is also why it cannot
  // be folded into the rebuild — it reads the very tenures the rebuild deletes,
  // so it is sound only when run first, as its own command, on its own.
  cmd
    .command("reconstruct-roster-completeness")
    .description(
      "Recover role_roster_completeness decisions from the closures recorded in " +
        "person_role, for filings extracted before that table existed. Reads and " +
        "writes only — no re-extraction. Run it BEFORE `resolve --rebuild-roles`, " +
        "which replaces the tenures it reads"
    )
    .action(async () => {
      await runCommand(async () => {
        const out = await runWorkflowCli<ReconstructRosterCompletenessTaskOutput>([
          new ReconstructRosterCompletenessTask(),
        ]);
        console.log(
          `read ${out.tenures} tenure(s); ${out.closures} roster closure(s); ` +
            `wrote ${out.written}, left ${out.alreadyRecorded} already recorded`
        );
        // Named rather than folded into the totals: an end date with no closing
        // accession is residue nothing here can attribute, and an operator
        // seeing a non-zero count is looking at rows no re-run will recover.
        if (out.unattributed > 0) {
          console.log(
            `${out.unattributed} end-dated tenure(s) name no closing accession and evidence no roster`
          );
        }
        // The verdicts this cannot recover are the ones absence already
        // expresses, so say so rather than let a small number read as a
        // partial failure.
        console.log(
          "Filings whose roster was incomplete, and complete rosters nobody had left, " +
            "close nothing and so leave no trace to read — both stay absent, which a " +
            "rebuild reads as 'not known complete' and closes nothing from."
        );
      });
    });
}
