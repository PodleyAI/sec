/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { FamilyDescriptionRepo } from "../storage/canonical/FamilyDescriptionRepo";
import type { FamilyDescriptionKind } from "../storage/canonical/FamilyDescriptionSchema";

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
      await new FamilyDescriptionRepo().setDescription(kind, normalized, text);
      console.log(`described '${name}'`);
    });

  fam
    .command("description <name>")
    .description(`Show the editorial description for a ${label} family`)
    .action(async (name: string) => {
      const desc = await new FamilyDescriptionRepo().getDescription(kind, normalize(name));
      console.log(desc ?? "");
    });
}
