/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeSponsorFamilyName } from "../../resolver/SponsorFamilyResolver";
import { normalizeUnderwriterFamilyName } from "../../resolver/UnderwriterFamilyResolver";
import type { CanonicalFamilyAliasRepo } from "../../storage/canonical/CanonicalFamilyAliasRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { CanonicalSponsorFamilyRepo } from "../../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { CanonicalUnderwriterFamilyRepo } from "../../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { SpacSponsorLinkRepo } from "../../storage/canonical/SpacSponsorLinkRepo";
import { UnderwriterLinkRepo } from "../../storage/canonical/UnderwriterLinkRepo";

/** The two family canonical tiers the parameterized family tasks operate on. */
export type FamilyKind = "sponsor" | "underwriter";

/**
 * Uniform access to a family tier's normalizer, canonical-row lookups, and
 * alias repo. The sponsor and underwriter tiers are structural mirrors that
 * differ only in repo classes and id column names, so the family tasks resolve
 * this seam once and stay kind-agnostic.
 */
export interface FamilyTierDeps {
  readonly kindLabel: "sponsor-family" | "underwriter-family";
  readonly aliases: () => CanonicalFamilyAliasRepo;
  /** Resolves a display name (normalized internally) to its canonical family id. */
  readonly findIdByName: (resolverVersion: string, name: string) => Promise<string | undefined>;
  readonly listIdsForResolverVersion: (resolverVersion: string) => Promise<string[]>;
  /** Issuer CIKs linked to one family id (link rows keep extraction-time ids). */
  readonly listIssuerCiksForFamily: (familyId: string) => Promise<number[]>;
  /**
   * Family id → display name, across every resolver version.
   *
   * An alias row holds only UUIDs, and the re-key ceremony an operator exports
   * aliases BEFORE is exactly what destroys those ids — so a listing that
   * prints ids alone cannot be used to restore anything. The name is the part
   * that survives, and it is what `alias <fromName> <intoName>` takes back.
   * Not version-scoped, because the alias listing is not either.
   */
  readonly displayNames: () => Promise<Map<string, string>>;
}

/**
 * Family rows as id → name, preferring the display name as first emitted and
 * falling back to the normalized key. The fallback matters: `display_name` is
 * nullable, and a blank cell in an export is an alias no import can restore —
 * the normalized key still resolves through the same `findIdByName` lookup.
 */
function familyDisplayNames(
  rows: readonly {
    readonly canonical_sponsor_family_id?: string;
    readonly canonical_underwriter_family_id?: string;
    readonly display_name: string | null;
    readonly normalized_name: string;
  }[]
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const id = row.canonical_sponsor_family_id ?? row.canonical_underwriter_family_id;
    if (id === undefined) continue;
    out.set(id, row.display_name ?? row.normalized_name);
  }
  return out;
}

export function familyTierDeps(family: FamilyKind): FamilyTierDeps {
  if (family === "sponsor") {
    return {
      kindLabel: "sponsor-family",
      aliases: () => new CanonicalSponsorFamilyAliasRepo(),
      findIdByName: async (resolverVersion, name) =>
        (
          await new CanonicalSponsorFamilyRepo().findByResolverAndName(
            resolverVersion,
            normalizeSponsorFamilyName(name)
          )
        )?.canonical_sponsor_family_id,
      listIdsForResolverVersion: async (resolverVersion) =>
        (await new CanonicalSponsorFamilyRepo().listForResolverVersion(resolverVersion)).map(
          (r) => r.canonical_sponsor_family_id
        ),
      listIssuerCiksForFamily: (familyId) =>
        new SpacSponsorLinkRepo().listIssuerCiksForFamily(familyId),
      displayNames: async () =>
        familyDisplayNames(await new CanonicalSponsorFamilyRepo().listAll()),
    };
  }
  return {
    kindLabel: "underwriter-family",
    aliases: () => new CanonicalUnderwriterFamilyAliasRepo(),
    findIdByName: async (resolverVersion, name) =>
      (
        await new CanonicalUnderwriterFamilyRepo().findByResolverAndName(
          resolverVersion,
          normalizeUnderwriterFamilyName(name)
        )
      )?.canonical_underwriter_family_id,
    listIdsForResolverVersion: async (resolverVersion) =>
      (await new CanonicalUnderwriterFamilyRepo().listForResolverVersion(resolverVersion)).map(
        (r) => r.canonical_underwriter_family_id
      ),
    listIssuerCiksForFamily: (familyId) =>
      new UnderwriterLinkRepo().listIssuerCiksForFamily(familyId),
    displayNames: async () =>
      familyDisplayNames(await new CanonicalUnderwriterFamilyRepo().listAll()),
  };
}

/**
 * Alias-aware issuer lookup for a family tier: the issuer CIKs of every SPAC
 * backed by (sponsor) or IPO underwritten by (underwriter) the named family.
 * Unions the resolved target family with every variant family id aliased into
 * it, since link rows keep the family id assigned at extraction time.
 */
export async function issuerCiksByFamilyName(
  family: FamilyKind,
  name: string,
  resolverVersion: string
): Promise<number[]> {
  const deps = familyTierDeps(family);
  const familyId = await deps.findIdByName(resolverVersion, name);
  if (!familyId) return [];

  const aliasRepo = deps.aliases();
  const target = await aliasRepo.resolve(familyId);
  const variantIds = (await aliasRepo.listByTarget(target)).map((a) => a.alias_canonical_id);

  const ciks = new Set<number>();
  for (const id of [target, ...variantIds]) {
    for (const cik of await deps.listIssuerCiksForFamily(id)) ciks.add(cik);
  }
  return [...ciks];
}
