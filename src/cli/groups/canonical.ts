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
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";
import { runWorkflowCli } from "../runWorkflow";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a CLI-supplied canonical reference (UUID or display name) to a
 * canonical UUID. Bare strings are matched case-insensitively against the
 * canonical's display name (`display_first display_last` composite or
 * `display_last` alone for persons; `display_name` for companies). The CLI
 * docs invite operators to pass names, so we must not let raw strings flow
 * straight into UUID-typed columns.
 *
 * Throws when the input does not look like a UUID and no canonical row
 * matches (or more than one does).
 */
/** @internal exported for unit tests */
export async function resolveCanonicalPersonRef(
  input: string,
  repo: CanonicalPersonRepo
): Promise<string> {
  const trimmed = input.trim();
  if (UUID_RE.test(trimmed)) return trimmed;
  const all = await repo.listAll();
  const lower = trimmed.toLowerCase();
  const matches = all.filter((r) => {
    const composite = [r.display_first, r.display_last]
      .filter((s): s is string => Boolean(s))
      .join(" ")
      .toLowerCase();
    const lastOnly = (r.display_last ?? "").toLowerCase();
    return composite === lower || lastOnly === lower;
  });
  if (matches.length === 0) {
    throw new Error(`no canonical person matches '${trimmed}'`);
  }
  if (matches.length > 1) {
    throw new Error(
      `multiple canonical persons match '${trimmed}': ${matches
        .map((m) => m.canonical_person_id)
        .join(", ")}`
    );
  }
  return matches[0].canonical_person_id;
}

/** @internal exported for unit tests */
export async function resolveCanonicalCompanyRef(
  input: string,
  repo: CanonicalCompanyRepo
): Promise<string> {
  const trimmed = input.trim();
  if (UUID_RE.test(trimmed)) return trimmed;
  const all = await repo.listAll();
  const lower = trimmed.toLowerCase();
  const matches = all.filter((r) => (r.display_name ?? "").toLowerCase() === lower);
  if (matches.length === 0) {
    throw new Error(`no canonical company matches '${trimmed}'`);
  }
  if (matches.length > 1) {
    throw new Error(
      `multiple canonical companies match '${trimmed}': ${matches
        .map((m) => m.canonical_company_id)
        .join(", ")}`
    );
  }
  return matches[0].canonical_company_id;
}

/** Registers `alias`, `alias-remove`, and `alias-list` on a person/company subgroup. */
function addAliasCommands(group: Command, kind: CanonicalEntityKind): void {
  group
    .command("alias <from> <into>")
    .option("--reason <text>", "free-text annotation")
    .action(async (from: string, into: string, opts: { reason?: string }) => {
      try {
        const { aliasId, targetId } = await runWorkflowCli<CanonicalAliasAddTaskOutput>([
          new CanonicalAliasAddTask({
            defaults: { kind, from, into, reason: opts.reason },
          }),
        ]);
        console.log(`aliased ${aliasId} → ${targetId}`);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
    });

  group.command("alias-remove <from>").action(async (from: string) => {
    try {
      const { removedId } = await runWorkflowCli<CanonicalAliasRemoveTaskOutput>([
        new CanonicalAliasRemoveTask({ defaults: { kind, from } }),
      ]);
      console.log(`removed alias for ${removedId}`);
    } catch (e) {
      console.error(`error: ${(e as Error).message}`);
      process.exitCode = 1;
      return;
    }
  });

  group
    .command("alias-list")
    .option("--orphans", "show only aliases referencing missing canonicals", false)
    .action(async (opts: { orphans: boolean }) => {
      try {
        const { aliases } = await runWorkflowCli<CanonicalAliasListTaskOutput>([
          new CanonicalAliasListTask({ defaults: { kind, orphans: opts.orphans } }),
        ]);
        for (const a of aliases) {
          console.log(`${a.alias_canonical_id}\t→\t${a.target_canonical_id}\t${a.reason ?? ""}`);
        }
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
    });
}

export function addCanonicalCommands(program: Command): void {
  const cmd = program.command("canonical");
  cmd.description("Manage canonical-identity aliases.");

  addAliasCommands(cmd.command("person"), "person");
  addAliasCommands(cmd.command("company"), "company");
}
