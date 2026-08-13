/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import type { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import type { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { FamilyResolver, normalizeFamilyName } from "./FamilyResolver";

interface SponsorFamilyResolverOptions {
  canonicalSponsorFamilyRepo: CanonicalSponsorFamilyRepo;
  canonicalSponsorFamilyAliasRepo: CanonicalSponsorFamilyAliasRepo;
  activeResolverVersion: string;
}

/**
 * The single source of truth for the sponsor-family natural key. Delegates to
 * {@link normalizeFamilyName} (punctuation/whitespace canonicalization plus the
 * suffix handling that helper applies, then UPPER-casing for case-insensitive
 * matching against `canonical_sponsor_family.normalized_name`). Every caller
 * that looks up a family by name (resolver, CLI query, alias commands) MUST
 * use this so keys line up. Returns "" when the name normalizes to nothing.
 */
export function normalizeSponsorFamilyName(name: string): string {
  return normalizeFamilyName(name);
}

/**
 * Resolves a sponsor legal name to a CanonicalSponsorFamily id: normalize ->
 * find-or-create at the active resolver version -> alias resolve. The family
 * key is {@link companyFamilyName} of that legal name (series markers and
 * legal forms drop; business-line words stay). Name-only analogue of
 * CompanyResolver's normalized-name fallback. Thin wrapper over the
 * shared {@link FamilyResolver}.
 */
export class SponsorFamilyResolver {
  private core: FamilyResolver;

  constructor(private opts: SponsorFamilyResolverOptions) {
    this.core = new FamilyResolver({
      kind: "sponsor",
      activeResolverVersion: opts.activeResolverVersion,
      findIdByNormalizedName: async (normalized) => {
        const existing = await opts.canonicalSponsorFamilyRepo.findByResolverAndName(
          opts.activeResolverVersion,
          normalized
        );
        return existing?.canonical_sponsor_family_id;
      },
      createFamily: async (displayName, normalized) => {
        const freshId = randomUUID();
        await opts.canonicalSponsorFamilyRepo.create({
          canonical_sponsor_family_id: freshId,
          resolver_version: opts.activeResolverVersion,
          display_name: displayName,
          normalized_name: normalized,
          created_at: new Date().toISOString(),
        });
        return freshId;
      },
      resolveAlias: (id) => opts.canonicalSponsorFamilyAliasRepo.resolve(id),
    });
  }

  async resolve(name: string): Promise<string> {
    return this.core.resolve(name);
  }
}
