/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { isJsonOutput } from "../isJsonOutput";
import { drainNextSteps, suggest } from "../nextSteps";
import { getPipelineStatus, type PipelineStatus } from "../queries/PipelineStatus";
import { runCommand } from "../runCommand";

/** Why each stage is worth advancing, in the same voice `suggest` uses. */
const WHY: Readonly<Record<string, string>> = {
  companies: "load the company list, or fetch one company",
  filings: "catch up EDGAR's daily index",
  facts: "refresh XBRL company facts",
  documents: "convert filings to readable markdown",
  advisers: "load the latest Form ADV archive",
};

/**
 * Renders the map: one line per stage, with what is in it and the command that
 * advances it.
 *
 * The right-hand column is deliberately the same string `suggest()` would
 * print. A reader who has run one command and read its "Next:" block can read
 * this screen, and the other way round.
 */
export function renderPipelineStatus(status: PipelineStatus): void {
  const where = status.location === undefined ? status.backend : `${status.location}`;
  console.log(`\n  EDGAR data in ${where} (${status.backend})\n`);

  const labelWidth = Math.max(...status.stages.map((stage) => stage.label.length));
  const summaryWidth = Math.max(...status.stages.map((stage) => stage.summary.length));
  for (const stage of status.stages) {
    const advance = stage.advance ?? "";
    console.log(
      `  ${stage.label.padEnd(labelWidth)}  ${stage.summary.padEnd(summaryWidth)}   ${advance}`.trimEnd()
    );
  }

  if (status.indexDaysBehind !== undefined && status.indexDaysBehind > 0) {
    const days = status.indexDaysBehind;
    console.log(`\n  Daily index is ${days} completed day${days === 1 ? "" : "s"} behind.`);
  }
}

export function addStatusCommand(program: Command): void {
  program
    .command("status")
    .description("What is loaded, how stale it is, and what to run next")
    .action(async () => {
      await runCommand(async () => {
        const status = await getPipelineStatus();
        if (status.headline !== undefined) {
          const stage = status.stages.find((s) => s.advance === status.headline);
          suggest({
            command: status.headline,
            why: (stage && WHY[stage.id]) ?? "bring everything current",
          });
        }
        if (isJsonOutput()) {
          console.log(JSON.stringify({ ...status, nextSteps: drainNextSteps() }, null, 2));
          return;
        }
        renderPipelineStatus(status);
      });
    });
}
