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

export function addCanonicalCommands(program: Command): void {
  const cmd = program.command("canonical");
  cmd.description("Manage canonical-identity aliases.");

  // --- person subgroup ---
  const person = cmd.command("person");

  person
    .command("alias <from> <into>")
    .option("--reason <text>", "free-text annotation")
    .action(async (from: string, into: string, opts: { reason?: string }) => {
      if (from === into) {
        console.error("error: cannot alias an id to itself");
        process.exit(1);
      }
      const aliasRepo = new CanonicalPersonAliasRepo();
      try {
        const row = await aliasRepo.add(from, into, opts.reason ?? null, process.env.USER ?? null);
        console.log(`aliased ${row.alias_canonical_id} → ${row.target_canonical_id}`);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exit(1);
      }
    });

  person
    .command("alias-remove <from>")
    .action(async (from: string) => {
      const aliasRepo = new CanonicalPersonAliasRepo();
      await aliasRepo.remove(from);
      console.log(`removed alias for ${from}`);
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
      if (from === into) {
        console.error("error: cannot alias an id to itself");
        process.exit(1);
      }
      const aliasRepo = new CanonicalCompanyAliasRepo();
      try {
        const row = await aliasRepo.add(from, into, opts.reason ?? null, process.env.USER ?? null);
        console.log(`aliased ${row.alias_canonical_id} → ${row.target_canonical_id}`);
      } catch (e) {
        console.error(`error: ${(e as Error).message}`);
        process.exit(1);
      }
    });

  company
    .command("alias-remove <from>")
    .action(async (from: string) => {
      const aliasRepo = new CanonicalCompanyAliasRepo();
      await aliasRepo.remove(from);
      console.log(`removed alias for ${from}`);
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
