/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { runCommand } from "../runCommand";
import { registerSecSyncLeaves } from "../sync/registerSecSyncLeaves";
import {
  listSyncLeaves,
  runSyncLeaves,
  type SyncLeaf,
  type SyncLeafOption,
  type SyncLeafOptionValues,
} from "../sync/syncLeaves";

export function validateLookback(lookback: number): number {
  if (lookback < 1) {
    throw new Error("--lookback must be at least 1");
  }
  return lookback;
}

/**
 * Declares a leaf's own options on one command.
 *
 * Applied per subcommand rather than once on the group: commander does not
 * hand a parent's options to a subcommand's action, so a flag declared on the
 * group would parse and then be dropped on the floor.
 */
function declareLeafOptions(command: Command, leaf: SyncLeaf): Command {
  for (const option of leaf.options ?? []) {
    declareOption(command, option);
  }
  return command;
}

/**
 * Commander's `option()` overloads split on whether a parser is supplied, and
 * its no-parser form types the third argument as `string | boolean | RegExp` —
 * so a numeric default has to arrive through the parser form.
 */
function declareOption(command: Command, option: SyncLeafOption): void {
  if (option.parse !== undefined) {
    command.option(option.flags, option.description, option.parse, option.defaultValue);
    return;
  }
  const fallback = option.defaultValue;
  if (typeof fallback === "string" || typeof fallback === "boolean") {
    command.option(option.flags, option.description, fallback);
    return;
  }
  command.option(option.flags, option.description);
}

/** Every declared option across every `inAll` leaf, for the group's own command. */
function declareAllLeafOptions(command: Command): Command {
  const seen = new Set<string>();
  for (const leaf of listSyncLeaves()) {
    if (!leaf.inAll) continue;
    for (const option of leaf.options ?? []) {
      if (seen.has(option.flags)) continue;
      seen.add(option.flags);
      declareOption(command, option);
    }
  }
  return command;
}

/**
 * Registers the `sync` group: one command per leaf, plus the bare group command
 * that runs every `inAll` leaf in order.
 */
export function addSyncCommand(program: Command): void {
  registerSecSyncLeaves();

  const sync = program
    .command("update")
    .alias("sync")
    .description("Bring what you already have current")
    .action(async function (this: Command) {
      const values = this.opts() as SyncLeafOptionValues;
      await runCommand(async () => {
        const failures = await runSyncLeaves(values, (leaf) => {
          console.log(`\n== sync ${leaf.id} ==`);
        });
        if (failures.length > 0) {
          const names = failures.map((failure) => failure.id).join(", ");
          for (const failure of failures) {
            const message =
              failure.error instanceof Error ? failure.error.message : String(failure.error);
            console.error(`sync ${failure.id}: ${message}`);
          }
          throw new Error(`sync failed for: ${names}`);
        }
      });
    });
  declareAllLeafOptions(sync);

  for (const leaf of listSyncLeaves()) {
    const command = sync.command(leaf.id).description(leaf.description);
    declareLeafOptions(command, leaf);
    command.action(async function (this: Command) {
      const values = this.opts() as SyncLeafOptionValues;
      await runCommand(async () => {
        await leaf.run(values);
      });
    });
  }
}

/** Adds the leaf commands to an already-created `sync` group. */
export function addSyncLeafCommands(sync: Command): void {
  registerSecSyncLeaves();
  for (const leaf of listSyncLeaves()) {
    const command = sync.command(leaf.id).description(leaf.description);
    declareLeafOptions(command, leaf);
    command.action(async function (this: Command) {
      const values = this.opts() as SyncLeafOptionValues;
      await runCommand(async () => {
        await leaf.run(values);
      });
    });
  }
}
