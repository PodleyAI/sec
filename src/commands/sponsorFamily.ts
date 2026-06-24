/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { normalizeSponsorFamilyName } from "../resolver/SponsorFamilyResolver";
import { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { SpacSponsorLinkRepo } from "../storage/canonical/SpacSponsorLinkRepo";

/**
 * Returns the issuer CIKs of every SPAC backed by the named sponsor family.
 * Alias-aware: unions the resolved target family with every variant family id
 * that has been aliased into it, since link rows keep the family id assigned at
 * extraction time.
 */
export async function spacIssuersByFamilyName(
  name: string,
  resolverVersion: string
): Promise<number[]> {
  const normalized = normalizeSponsorFamilyName(name);
  if (!normalized) return [];
  const families = new CanonicalSponsorFamilyRepo();
  const family = await families.findByResolverAndName(resolverVersion, normalized);
  if (!family) return [];

  const aliases = new CanonicalSponsorFamilyAliasRepo();
  const target = await aliases.resolve(family.canonical_sponsor_family_id);
  const variantIds = (await aliases.listByTarget(target)).map((a) => a.alias_canonical_id);
  const familyIds = [target, ...variantIds];

  const links = new SpacSponsorLinkRepo();
  const ciks = new Set<number>();
  for (const id of familyIds) {
    for (const cik of await links.listIssuerCiksForFamily(id)) ciks.add(cik);
  }
  return [...ciks];
}

/**
 * Registers `sec canonical sponsor-family alias|alias-list` and `sec spac by-family`.
 * Must be called after {@link addCanonicalCommands} so that `program.commands`
 * already contains the `canonical` subcommand.
 */
export function registerSponsorFamilyCommands(program: Command): void {
  const canonical = program.commands.find((c) => c.name() === "canonical") ?? program;

  const fam = new Command("sponsor-family").description("Manage sponsor-family canonical entities");

  fam
    .command("alias <fromName> <intoName>")
    .description("Merge an AI-emitted variant family name into another")
    .option("--reason <reason>", "why these were merged")
    .option("--resolver-version <v>", "resolver version", "1.0.0")
    .action(
      async (
        fromName: string,
        intoName: string,
        opts: { reason?: string; resolverVersion: string }
      ) => {
        const families = new CanonicalSponsorFamilyRepo();
        const from = await families.findByResolverAndName(
          opts.resolverVersion,
          normalizeSponsorFamilyName(fromName)
        );
        const into = await families.findByResolverAndName(
          opts.resolverVersion,
          normalizeSponsorFamilyName(intoName)
        );
        if (!from || !into) {
          console.error("error: both family names must already exist");
          process.exitCode = 1;
          return;
        }
        try {
          await new CanonicalSponsorFamilyAliasRepo().add(
            from.canonical_sponsor_family_id,
            into.canonical_sponsor_family_id,
            opts.reason ?? null,
            "cli"
          );
          console.log(`aliased '${fromName}' -> '${intoName}'`);
        } catch (e) {
          console.error(`error: ${(e as Error).message}`);
          process.exitCode = 1;
          return;
        }
      }
    );

  fam
    .command("alias-list")
    .description("List all sponsor-family aliases")
    .action(async () => {
      const rows = await new CanonicalSponsorFamilyAliasRepo().list();
      for (const r of rows) {
        console.log(`${r.alias_canonical_id}\t->\t${r.target_canonical_id}\t${r.reason ?? ""}`);
      }
    });

  canonical.addCommand(fam);

  program
    .command("spac")
    .description("SPAC queries")
    .addCommand(
      new Command("by-family")
        .description("List issuer CIKs for SPACs backed by a sponsor family")
        .argument("<name>", "sponsor family display name")
        .option("--resolver-version <v>", "resolver version", "1.0.0")
        .action(async (name: string, opts: { resolverVersion: string }) => {
          const ciks = await spacIssuersByFamilyName(name, opts.resolverVersion);
          console.log(JSON.stringify(ciks));
        })
    );
}
