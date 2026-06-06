/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import type { CanonicalUnderwriterFamilyRepo } from "../storage/canonical/CanonicalUnderwriterFamilyRepo";
import type { CanonicalUnderwriterFamilyAliasRepo } from "../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { normalizeCompanyName } from "../storage/company/CompanyNormalization";
import { AsyncMutex } from "../util/AsyncMutex";

/** Shared normalization so the CLI and the extractor key families identically. */
export function normalizeUnderwriterFamilyName(name: string): string {
  return normalizeCompanyName(name)?.toLowerCase() ?? "";
}

interface UnderwriterFamilyResolverOptions {
  canonicalUnderwriterFamilyRepo: CanonicalUnderwriterFamilyRepo;
  canonicalUnderwriterFamilyAliasRepo: CanonicalUnderwriterFamilyAliasRepo;
  activeResolverVersion: string;
}

/**
 * Resolves an underwriter *common* name to a CanonicalUnderwriterFamily id:
 * normalize → find-or-create at the active resolver version → alias resolve.
 * Name-only analogue of SponsorFamilyResolver.
 */
export class UnderwriterFamilyResolver {
  private static readonly _keyMutexes = new Map<string, { mutex: AsyncMutex; refs: number }>();

  constructor(private opts: UnderwriterFamilyResolverOptions) {}

  async resolve(commonName: string): Promise<string> {
    const normalized = normalizeUnderwriterFamilyName(commonName);
    if (!normalized) throw new Error("cannot resolve underwriter family: empty common name");
    const key = `${this.opts.activeResolverVersion}|underwriter-family|${normalized}`;

    let entry = UnderwriterFamilyResolver._keyMutexes.get(key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      UnderwriterFamilyResolver._keyMutexes.set(key, entry);
    }
    entry.refs += 1;

    let candidateId: string;
    try {
      candidateId = await entry.mutex.lock(async () => {
        const existing = await this.opts.canonicalUnderwriterFamilyRepo.findByResolverAndName(
          this.opts.activeResolverVersion,
          normalized
        );
        if (existing) return existing.canonical_underwriter_family_id;
        const freshId = randomUUID();
        await this.opts.canonicalUnderwriterFamilyRepo.create({
          canonical_underwriter_family_id: freshId,
          resolver_version: this.opts.activeResolverVersion,
          display_name: commonName,
          normalized_name: normalized,
          created_at: new Date().toISOString(),
        });
        return freshId;
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0 && UnderwriterFamilyResolver._keyMutexes.get(key) === entry) {
        UnderwriterFamilyResolver._keyMutexes.delete(key);
      }
    }

    return this.opts.canonicalUnderwriterFamilyAliasRepo.resolve(candidateId);
  }
}
