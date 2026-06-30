/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { CanonicalPersonAliasRepo } from "../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalCompanyAliasRepo } from "../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalPersonRepo } from "../../storage/canonical/CanonicalPersonRepo";
import { CanonicalCompanyRepo } from "../../storage/canonical/CanonicalCompanyRepo";

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

export function addCanonicalCommands(program: Command): void {
  const cmd = program.command("canonical");
  cmd.description("Manage canonical-identity aliases.");

  // --- person subgroup ---
  const person = cmd.command("person");

  person
    .command("alias <from> <into>")
    .option("--reason <text>", "free-text annotation")
    .action(async (from: string, into: string, opts: { reason?: string }) => {
      const canonRepo = new CanonicalPersonRepo();
      let fromId: string;
      let intoId: string;
      try {
        fromId = await resolveCanonicalPersonRef(from, canonRepo);
        intoId = await resolveCanonicalPersonRef(into, canonRepo);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
      if (fromId === intoId) {
        console.error("error: cannot alias an id to itself");
        process.exitCode = 1;
        return;
      }
      const aliasRepo = new CanonicalPersonAliasRepo();
      try {
        const row = await aliasRepo.add(
          fromId,
          intoId,
          opts.reason ?? null,
          process.env.USER ?? null
        );
        console.log(`aliased ${row.alias_canonical_id} → ${row.target_canonical_id}`);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
    });

  person
    .command("alias-remove <from>")
    .action(async (from: string) => {
      const canonRepo = new CanonicalPersonRepo();
      let fromId: string;
      try {
        fromId = await resolveCanonicalPersonRef(from, canonRepo);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
      const aliasRepo = new CanonicalPersonAliasRepo();
      await aliasRepo.remove(fromId);
      console.log(`removed alias for ${fromId}`);
    });

  person
    .command("alias-list")
    .option("--orphans", "show only aliases referencing missing canonicals", false)
    .action(async (opts: { orphans: boolean }) => {
      const aliasRepo = new CanonicalPersonAliasRepo();
      if (opts.orphans) {
        const canonRepo = new CanonicalPersonRepo();
        const allIds = new Set((await canonRepo.listAll()).map((r) => r.canonical_person_id));
        const list = await aliasRepo.listOrphans(allIds);
        for (const a of list) {
          console.log(`${a.alias_canonical_id}\t→\t${a.target_canonical_id}\t${a.reason ?? ""}`);
        }
      } else {
        const list = await aliasRepo.list();
        for (const a of list) {
          console.log(`${a.alias_canonical_id}\t→\t${a.target_canonical_id}\t${a.reason ?? ""}`);
        }
      }
    });

  // --- company subgroup (mirror of person) ---
  const company = cmd.command("company");

  company
    .command("alias <from> <into>")
    .option("--reason <text>", "free-text annotation")
    .action(async (from: string, into: string, opts: { reason?: string }) => {
      const canonRepo = new CanonicalCompanyRepo();
      let fromId: string;
      let intoId: string;
      try {
        fromId = await resolveCanonicalCompanyRef(from, canonRepo);
        intoId = await resolveCanonicalCompanyRef(into, canonRepo);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
      if (fromId === intoId) {
        console.error("error: cannot alias an id to itself");
        process.exitCode = 1;
        return;
      }
      const aliasRepo = new CanonicalCompanyAliasRepo();
      try {
        const row = await aliasRepo.add(
          fromId,
          intoId,
          opts.reason ?? null,
          process.env.USER ?? null
        );
        console.log(`aliased ${row.alias_canonical_id} → ${row.target_canonical_id}`);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
    });

  company
    .command("alias-remove <from>")
    .action(async (from: string) => {
      const canonRepo = new CanonicalCompanyRepo();
      let fromId: string;
      try {
        fromId = await resolveCanonicalCompanyRef(from, canonRepo);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exitCode = 1;
        return;
      }
      const aliasRepo = new CanonicalCompanyAliasRepo();
      await aliasRepo.remove(fromId);
      console.log(`removed alias for ${fromId}`);
    });

  company
    .command("alias-list")
    .option("--orphans", "show only aliases referencing missing canonicals", false)
    .action(async (opts: { orphans: boolean }) => {
      const aliasRepo = new CanonicalCompanyAliasRepo();
      if (opts.orphans) {
        const canonRepo = new CanonicalCompanyRepo();
        const allIds = new Set((await canonRepo.listAll()).map((r) => r.canonical_company_id));
        const list = await aliasRepo.listOrphans(allIds);
        for (const a of list) {
          console.log(`${a.alias_canonical_id}\t→\t${a.target_canonical_id}\t${a.reason ?? ""}`);
        }
      } else {
        const list = await aliasRepo.list();
        for (const a of list) {
          console.log(`${a.alias_canonical_id}\t→\t${a.target_canonical_id}\t${a.reason ?? ""}`);
        }
      }
    });
}
