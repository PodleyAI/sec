/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import type { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import type { CanonicalUnderwriterFamilyAliasRepo } from "../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { FamilyResolver, normalizeFamilyName } from "./FamilyResolver";

/** Shared normalization so the CLI and the extractor key families identically. */
export function normalizeUnderwriterFamilyName(name: string): string {
  return normalizeFamilyName(name);
}

interface UnderwriterFamilyResolverOptions {
  canonicalUnderwriterFamilyRepo: CanonicalUnderwriterFamilyRepo;
  canonicalUnderwriterFamilyAliasRepo: CanonicalUnderwriterFamilyAliasRepo;
  activeResolverVersion: string;
}

/**
 * Resolves an underwriter legal name to a CanonicalUnderwriterFamily id:
 * normalize → find-or-create at the active resolver version → alias resolve.
 * The family key is {@link companyFamilyName} of that legal name. Name-only
 * analogue of SponsorFamilyResolver. Thin wrapper over the shared
 * {@link FamilyResolver}.
 */
export class UnderwriterFamilyResolver {
  private core: FamilyResolver;

  constructor(private opts: UnderwriterFamilyResolverOptions) {
    this.core = new FamilyResolver({
      kind: "underwriter",
      activeResolverVersion: opts.activeResolverVersion,
      findIdByNormalizedName: async (normalized) => {
        const existing = await opts.canonicalUnderwriterFamilyRepo.findByResolverAndName(
          opts.activeResolverVersion,
          normalized
        );
        return existing?.canonical_underwriter_family_id;
      },
      createFamily: async (displayName, normalized) => {
        const freshId = randomUUID();
        await opts.canonicalUnderwriterFamilyRepo.create({
          canonical_underwriter_family_id: freshId,
          resolver_version: opts.activeResolverVersion,
          display_name: displayName,
          normalized_name: normalized,
          created_at: new Date().toISOString(),
        });
        return freshId;
      },
      resolveAlias: (id) => opts.canonicalUnderwriterFamilyAliasRepo.resolve(id),
    });
  }

  async resolve(name: string): Promise<string> {
    return this.core.resolve(name);
  }
}
