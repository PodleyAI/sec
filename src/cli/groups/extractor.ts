/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { withCli } from "@workglow/cli";
import { runCommand } from "../runCommand";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { RetryDeadLettersTask } from "../../task/forms/RetryDeadLettersTask";

/** Number of pending dead-letter entries now eligible under the current version. */
export async function countEligibleDeadLetters(extractorId: string): Promise<number> {
  const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
  const slot = await getActiveSlot(reg, "extractor", extractorId);
  if (!slot) return 0;
  return new ExtractionDeadLetterRepo().countEligible(extractorId, slot.semver);
}

export function addExtractorCommands(program: Command): void {
  const cmd = program.command("extractor").description("Inspect and drain extractor dead-letters");

  cmd
    .command("dead-letters <extractorId>")
    .description("List dead-letter entries for an extractor")
    .option("--eligible", "only show the count eligible for retry under the current version", false)
    .action(async (extractorId: string, opts: { eligible: boolean }) => {
      await runCommand(async () => {
        const repo = new ExtractionDeadLetterRepo();
        if (opts.eligible) {
          const n = await countEligibleDeadLetters(extractorId);
          console.log(`${n} dead-letter entr${n === 1 ? "y" : "ies"} eligible for retry`);
          return;
        }
        const pending = await repo.listPending(extractorId);
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
    .command("retry-dead-letters <extractorId>")
    .description("Re-run filings whose dead-letter entries are eligible under the current version")
    .action(async (extractorId: string) => {
      await runCommand(async () => {
        const out = (await withCli(new RetryDeadLettersTask()).run({ extractorId })) as {
          eligibleAccessions: string[];
          reprocessed: number;
        };
        console.log(
          `reprocessed ${out.reprocessed} filing(s) from ${out.eligibleAccessions.length} eligible`
        );
      });
    });
}
