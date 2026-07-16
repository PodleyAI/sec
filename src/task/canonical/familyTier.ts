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
  };
}
