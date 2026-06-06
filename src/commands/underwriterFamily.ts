/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { normalizeUnderwriterFamilyName } from "../resolver/UnderwriterFamilyResolver";
import { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { UnderwriterLinkRepo } from "../storage/canonical/UnderwriterLinkRepo";
import { IssuerTickerRepo } from "../storage/offering/IssuerTickerRepo";

/**
 * Returns the issuer CIKs of every IPO underwritten by the named family.
 * Alias-aware: unions the resolved target family with every variant family id
 * aliased into it, since link rows keep the family id assigned at extraction time.
 */
export async function ipoIssuersByUnderwriterFamilyName(
  name: string,
  resolverVersion: string
): Promise<number[]> {
  const normalized = normalizeUnderwriterFamilyName(name);
  if (!normalized) return [];
  const families = new CanonicalUnderwriterFamilyRepo();
  const family = await families.findByResolverAndName(resolverVersion, normalized);
  if (!family) return [];

  const aliases = new CanonicalUnderwriterFamilyAliasRepo();
  const target = await aliases.resolve(family.canonical_underwriter_family_id);
  const variantIds = (await aliases.listByTarget(target)).map((a) => a.alias_canonical_id);
  const familyIds = [target, ...variantIds];

  const links = new UnderwriterLinkRepo();
  const ciks = new Set<number>();
  for (const id of familyIds) {
    for (const cik of await links.listIssuerCiksForFamily(id)) ciks.add(cik);
  }
  return [...ciks];
}

/**
 * Registers `sec canonical underwriter-family alias|alias-list`,
 * `sec underwriter by-family`, and `sec issuer tickers`. Must be called after
 * the `canonical` subcommand is registered.
 */
export function registerUnderwriterFamilyCommands(program: Command): void {
  const canonical = program.commands.find((c) => c.name() === "canonical") ?? program;

  const fam = new Command("underwriter-family").description(
    "Manage underwriter-family canonical entities"
  );

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
        const families = new CanonicalUnderwriterFamilyRepo();
        const from = await families.findByResolverAndName(
          opts.resolverVersion,
          normalizeUnderwriterFamilyName(fromName)
        );
        const into = await families.findByResolverAndName(
          opts.resolverVersion,
          normalizeUnderwriterFamilyName(intoName)
        );
        if (!from || !into) {
          console.error("error: both family names must already exist");
          process.exit(1);
        }
        try {
          await new CanonicalUnderwriterFamilyAliasRepo().add(
            from.canonical_underwriter_family_id,
            into.canonical_underwriter_family_id,
            opts.reason ?? null,
            "cli"
          );
          console.log(`aliased '${fromName}' -> '${intoName}'`);
        } catch (e) {
          console.error(`error: ${(e as Error).message}`);
          process.exit(1);
        }
      }
    );

  fam
    .command("alias-list")
    .description("List all underwriter-family aliases")
    .action(async () => {
      const rows = await new CanonicalUnderwriterFamilyAliasRepo().list();
      for (const r of rows) {
        console.log(`${r.alias_canonical_id}\t->\t${r.target_canonical_id}\t${r.reason ?? ""}`);
      }
    });

  canonical.addCommand(fam);

  program
    .command("underwriter")
    .description("Underwriter queries")
    .addCommand(
      new Command("by-family")
        .description("List issuer CIKs for IPOs underwritten by a family")
        .argument("<name>", "underwriter family display name")
        .option("--resolver-version <v>", "resolver version", "1.0.0")
        .action(async (name: string, opts: { resolverVersion: string }) => {
          const ciks = await ipoIssuersByUnderwriterFamilyName(name, opts.resolverVersion);
          console.log(JSON.stringify(ciks));
        })
    );

  program
    .command("issuer")
    .description("Issuer queries")
    .addCommand(
      new Command("tickers")
        .description("List the point-in-time ticker series for an issuer CIK")
        .argument("<cik>", "issuer CIK")
        .action(async (cik: string) => {
          const rows = await new IssuerTickerRepo().history(Number(cik));
          for (const r of rows) {
            console.log(
              `${r.filing_date ?? ""}\t${r.exchange}\t${r.ticker}\t${r.is_primary ? "primary" : ""}`
            );
          }
        })
    );
}
