/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { runWorkflowCli } from "../cli/runWorkflow";
import {
  FamilyAliasAddTask,
  type FamilyAliasAddTaskOutput,
} from "../task/canonical/FamilyAliasAddTask";
import {
  FamilyAliasListTask,
  type FamilyAliasListTaskOutput,
} from "../task/canonical/FamilyAliasListTask";
import { formatAliasLine, formatAliasTsv, parseAliasTsv } from "../task/canonical/aliasTsv";
import type { FamilyKind } from "../task/canonical/familyTier";

/**
 * Registers `alias-list` and `alias-import` on a family group.
 *
 * Shared by the sponsor and underwriter groups so the two cannot drift: the
 * export an operator takes before a re-key must have the same shape on both,
 * because a wipe hits both at once.
 */
export function registerFamilyAliasExchange(
  fam: Command,
  family: FamilyKind,
  label: "sponsor-family" | "underwriter-family"
): void {
  fam
    .command("alias-list")
    .description(
      `List all ${label} aliases with their display names. \`--format tsv\` is ` +
        "the export `alias-import` reads — take one before any re-key ceremony."
    )
    .option("--orphans", "show only aliases referencing missing canonicals", false)
    .option("--format <fmt>", "output format: text | tsv", "text")
    .option("--resolver-version <v>", "resolver version", "1.0.0")
    .action(async (opts: { orphans: boolean; format: string; resolverVersion: string }) => {
      try {
        const { aliases } = await runWorkflowCli<FamilyAliasListTaskOutput>([
          new FamilyAliasListTask({
            defaults: {
              family,
              orphans: opts.orphans,
              resolverVersion: opts.resolverVersion,
            },
          }),
        ]);
        if (opts.format === "tsv") {
          process.stdout.write(formatAliasTsv(aliases));
          return;
        }
        for (const a of aliases) console.log(formatAliasLine(a));
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
      }
    });

  fam
    .command("alias-import <file>")
    .description("Re-create aliases from an `alias-list --format tsv` export")
    .option("--resolver-version <v>", "resolver version", "1.0.0")
    .action(async (file: string, opts: { resolverVersion: string }) => {
      // Names, not ids: an import exists because the wipe that made the export
      // necessary destroyed the ids it references. Both names must already
      // exist as canonical family rows, which is why re-extraction comes first.
      const { rows, errors } = parseAliasTsv(await readFile(file, "utf-8"));
      for (const message of errors) {
        console.error(`error: ${message}`);
        process.exitCode = 1;
      }
      let added = 0;
      for (const row of rows) {
        const out = await runWorkflowCli<FamilyAliasAddTaskOutput>([
          new FamilyAliasAddTask({
            defaults: {
              family,
              fromName: row.from,
              intoName: row.into,
              reason: row.reason,
              resolverVersion: opts.resolverVersion,
            },
          }),
        ]);
        if (out.error !== null) {
          // One unresolvable pair must not abandon the rest: an import runs
          // after a wipe, where a family that has not been re-extracted yet is
          // an expected partial failure, not a reason to lose the others.
          console.error(`error: '${row.from}' -> '${row.into}': ${out.error}`);
          process.exitCode = 1;
          continue;
        }
        added += 1;
      }
      console.log(`imported ${added} of ${rows.length} aliases`);
    });
}
