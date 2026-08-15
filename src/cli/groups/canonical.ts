/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import { formatAliasLine, formatAliasTsv, parseAliasTsv } from "../../task/canonical/aliasTsv";
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
import {
  SuggestAliasesTask,
  type SuggestAliasesTaskOutput,
} from "../../task/canonical/SuggestAliasesTask";
import { ALIAS_SUGGESTION_KINDS, isAliasSuggestionKind } from "../../task/canonical/suggestAliases";
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

/**
 * Registers `alias`, `alias-remove`, `alias-list` and `alias-import` on a
 * person/company subgroup.
 */
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
    .option("--format <fmt>", "output format: text | tsv", "text")
    .description(
      "List aliases with their display names. `--format tsv` is the export " +
        "`alias-import` reads — take one before any re-key ceremony."
    )
    .action(async (opts: { orphans: boolean; format: string }) => {
      const { aliases } = await runWorkflowCli<CanonicalAliasListTaskOutput>([
        new CanonicalAliasListTask({ defaults: { kind, orphans: opts.orphans } }),
      ]);
      if (opts.format === "tsv") {
        process.stdout.write(formatAliasTsv(aliases));
        return;
      }
      for (const a of aliases) console.log(formatAliasLine(a));
    });

  group
    .command("alias-import <file>")
    .description("Re-create aliases from an `alias-list --format tsv` export")
    .action(async (file: string) => {
      // Names, not ids: an import exists because the ids in the export no
      // longer resolve. `CanonicalAliasAddTask` accepts either, and resolves a
      // bare name against the canonical display names.
      const { rows, errors } = parseAliasTsv(await readFile(file, "utf-8"));
      for (const message of errors) printError(message);
      let added = 0;
      for (const row of rows) {
        const out = await runWorkflowCli<CanonicalAliasAddTaskOutput>([
          new CanonicalAliasAddTask({
            defaults: { kind, from: row.from, into: row.into, reason: row.reason },
          }),
        ]);
        if (out.error !== null) {
          // One unresolvable pair must not abandon the rest: an import runs
          // after a wipe, where a name that has not been re-extracted yet is an
          // expected partial failure, not a reason to lose the other 40.
          printError(`${row.from} → ${row.into}: ${out.error}`);
          continue;
        }
        added += 1;
      }
      console.log(`imported ${added} of ${rows.length} aliases`);
    });
}

export function addCanonicalCommands(program: Command): void {
  const cmd = program.command("canonical");
  cmd.description("Manage canonical-identity aliases.");

  addAliasCommands(cmd.command("person"), "person");
  addAliasCommands(cmd.command("company"), "company");

  // Registered once for all three company-keyed kinds rather than per subgroup:
  // the scan is over EDGAR's entity name history, which is the same table
  // whichever tier the split landed in.
  cmd
    .command("suggest-aliases")
    .description(
      "Suggest aliases for filers EDGAR has carried under two spellings of one " +
        "name (its own typo corrections split them into two canonical rows). " +
        "`--format tsv` is the export `alias-import` reads."
    )
    .requiredOption("--kind <kind>", ALIAS_SUGGESTION_KINDS.join(" | "))
    .option("--format <fmt>", "output format: text | tsv", "text")
    .action(async (opts: { kind: string; format: string }) => {
      if (!isAliasSuggestionKind(opts.kind)) {
        printError(`--kind must be one of ${ALIAS_SUGGESTION_KINDS.join("|")}`);
        return;
      }
      const { suggestions, scanned } = await runWorkflowCli<SuggestAliasesTaskOutput>([
        new SuggestAliasesTask({ defaults: { kind: opts.kind } }),
      ]);
      if (opts.format === "tsv") {
        process.stdout.write(
          formatAliasTsv(
            suggestions.map((s) => ({
              alias_name: s.from,
              target_name: s.into,
              reason: s.reason,
              alias_canonical_id: "",
              target_canonical_id: "",
            }))
          )
        );
        return;
      }
      // Suggestions, not decisions: an operator reads them against the filings
      // before piping the export into `alias-import`.
      for (const s of suggestions) {
        console.log(`${s.from}\t-> ${s.into}\t(${s.reason})`);
      }
      console.log(`${suggestions.length} suggestion(s) across ${scanned} filer(s)`);
    });
}
