/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import type { CanonicalSponsorFamilyRepo } from "../storage/canonical/CanonicalSponsorFamilyRepo";
import type { CanonicalSponsorFamilyAliasRepo } from "../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { normalizeCompanyName } from "../storage/company/CompanyNormalization";
import { AsyncMutex } from "../util/AsyncMutex";

interface SponsorFamilyResolverOptions {
  canonicalSponsorFamilyRepo: CanonicalSponsorFamilyRepo;
  canonicalSponsorFamilyAliasRepo: CanonicalSponsorFamilyAliasRepo;
  activeResolverVersion: string;
}

/**
 * The single source of truth for the sponsor-family natural key. Normalizes the
 * name via {@link normalizeCompanyName} (punctuation/whitespace canonicalization
 * plus the suffix handling that helper applies), then upper-cases so matching is
 * case-insensitive. Every caller that looks up a family by name (resolver, CLI
 * query, alias commands) MUST use this so keys line up. Returns "" when the name
 * normalizes to nothing.
 */
export function normalizeSponsorFamilyName(name: string): string {
  return normalizeCompanyName(name)?.toUpperCase() ?? "";
}

/**
 * Resolves a sponsor *common* name to a CanonicalSponsorFamily id: normalize ->
 * find-or-create at the active resolver version -> alias resolve. Name-only
 * analogue of CompanyResolver's normalized-name fallback.
 */
export class SponsorFamilyResolver {
  private static readonly _keyMutexes = new Map<string, { mutex: AsyncMutex; refs: number }>();

  constructor(private opts: SponsorFamilyResolverOptions) {}

  async resolve(commonName: string): Promise<string> {
    const normalized = normalizeSponsorFamilyName(commonName);
    if (!normalized) throw new Error("cannot resolve sponsor family: empty common name");
    const key = `${this.opts.activeResolverVersion}|sponsor-family|${normalized}`;

    let entry = SponsorFamilyResolver._keyMutexes.get(key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      SponsorFamilyResolver._keyMutexes.set(key, entry);
    }
    entry.refs += 1;

    let candidateId: string;
    try {
      candidateId = await entry.mutex.lock(async () => {
        const existing = await this.opts.canonicalSponsorFamilyRepo.findByResolverAndName(
          this.opts.activeResolverVersion,
          normalized
        );
        if (existing) return existing.canonical_sponsor_family_id;
        const freshId = randomUUID();
        await this.opts.canonicalSponsorFamilyRepo.create({
          canonical_sponsor_family_id: freshId,
          resolver_version: this.opts.activeResolverVersion,
          display_name: commonName,
          normalized_name: normalized,
          created_at: new Date().toISOString(),
        });
        return freshId;
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0 && SponsorFamilyResolver._keyMutexes.get(key) === entry) {
        SponsorFamilyResolver._keyMutexes.delete(key);
      }
    }

    return this.opts.canonicalSponsorFamilyAliasRepo.resolve(candidateId);
  }
}
