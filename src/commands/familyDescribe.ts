/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { runWorkflowCli } from "../cli/runWorkflow";
import type { FamilyDescriptionKind } from "../storage/canonical/FamilyDescriptionSchema";
import {
  FamilyDescriptionGetTask,
  type FamilyDescriptionGetTaskOutput,
} from "../task/canonical/FamilyDescriptionGetTask";
import { FamilyDescriptionSetTask } from "../task/canonical/FamilyDescriptionSetTask";

/**
 * Registers the `describe <name> <text>` / `description <name>` editorial
 * subcommands on a family command group. Shared by the sponsor-family and
 * underwriter-family CLIs, which differ only in their name normalizer and the
 * family kind. Callers pass the SAME normalizer the resolver/alias commands use
 * so the description keys line up.
 */
export function registerFamilyDescribeCommands(
  fam: Command,
  kind: FamilyDescriptionKind,
  normalize: (name: string) => string
): void {
  const label = kind === "sponsor-family" ? "sponsor" : "underwriter";
  fam
    .command("describe <name> <text>")
    .description(`Set the editorial description for a ${label} family (manual/embarc)`)
    .action(async (name: string, text: string) => {
      const normalized = normalize(name);
      if (!normalized) {
        console.error("error: name normalizes to empty");
        process.exitCode = 1;
        return;
      }
      await runWorkflowCli([
        new FamilyDescriptionSetTask({
          defaults: { kind, normalizedName: normalized, text },
        }),
      ]);
      console.log(`described '${name}'`);
    });

  fam
    .command("description <name>")
    .description(`Show the editorial description for a ${label} family`)
    .action(async (name: string) => {
      const { description } = await runWorkflowCli<FamilyDescriptionGetTaskOutput>([
        new FamilyDescriptionGetTask({
          defaults: { kind, normalizedName: normalize(name) },
        }),
      ]);
      console.log(description ?? "");
    });
}
