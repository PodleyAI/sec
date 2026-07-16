/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import {
  CanonicalAliasAddTask,
  type CanonicalAliasAddTaskOutput,
  type CanonicalEntityKind,
} from "../../task/canonical/CanonicalAliasAddTask";
import {
  CanonicalAliasListTask,
  type CanonicalAliasListTaskOutput,
} from "../../task/canonical/CanonicalAliasListTask";
import {
  CanonicalAliasRemoveTask,
  type CanonicalAliasRemoveTaskOutput,
} from "../../task/canonical/CanonicalAliasRemoveTask";
import { runWorkflowCli } from "../runWorkflow";

// Resolution lives with the canonical tier tasks; re-exported here for the
// unit tests that exercise the resolvers directly.
export {
  resolveCanonicalCompanyRef,
  resolveCanonicalPersonRef,
} from "../../task/canonical/canonicalTier";

/** Print an expected user-error the way this command group always has. */
function printError(message: string): void {
  console.error(`error: ${message}`);
  process.exitCode = 1;
}

/** Registers `alias`, `alias-remove`, and `alias-list` on a person/company subgroup. */
function addAliasCommands(group: Command, kind: CanonicalEntityKind): void {
  group
    .command("alias <from> <into>")
    .option("--reason <text>", "free-text annotation")
    .action(async (from: string, into: string, opts: { reason?: string }) => {
      // Expected failures (unresolvable name, self-alias) come back as the
      // task's `error` output port rather than a throw, so this renders
      // identically on a TTY and when piped.
      const out = await runWorkflowCli<CanonicalAliasAddTaskOutput>([
        new CanonicalAliasAddTask({
          defaults: { kind, from, into, reason: opts.reason },
        }),
      ]);
      if (out.error !== null) {
        printError(out.error);
        return;
      }
      console.log(`aliased ${out.aliasId} → ${out.targetId}`);
    });

  group.command("alias-remove <from>").action(async (from: string) => {
    const out = await runWorkflowCli<CanonicalAliasRemoveTaskOutput>([
      new CanonicalAliasRemoveTask({ defaults: { kind, from } }),
    ]);
    if (out.error !== null) {
      printError(out.error);
      return;
    }
    console.log(`removed alias for ${out.removedId}`);
  });

  group
    .command("alias-list")
    .option("--orphans", "show only aliases referencing missing canonicals", false)
    .action(async (opts: { orphans: boolean }) => {
      const { aliases } = await runWorkflowCli<CanonicalAliasListTaskOutput>([
        new CanonicalAliasListTask({ defaults: { kind, orphans: opts.orphans } }),
      ]);
      for (const a of aliases) {
        console.log(`${a.alias_canonical_id}\t→\t${a.target_canonical_id}\t${a.reason ?? ""}`);
      }
    });
}

export function addCanonicalCommands(program: Command): void {
  const cmd = program.command("canonical");
  cmd.description("Manage canonical-identity aliases.");

  addAliasCommands(cmd.command("person"), "person");
  addAliasCommands(cmd.command("company"), "company");
}
