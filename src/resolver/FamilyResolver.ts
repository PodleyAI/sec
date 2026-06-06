/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeCompanyName } from "../storage/company/CompanyNormalization";
import { AsyncMutex } from "../util/AsyncMutex";

/**
 * The single source of truth for a family natural key (sponsor or underwriter).
 * Normalizes the name via {@link normalizeCompanyName} (punctuation/whitespace
 * canonicalization plus the suffix handling that helper applies), then
 * lower-cases so matching is case-insensitive. Every caller that looks up a
 * family by name (resolver, CLI query, alias commands) MUST use this so keys
 * line up. Returns "" when the name normalizes to nothing.
 */
export function normalizeFamilyName(name: string): string {
  return normalizeCompanyName(name)?.toLowerCase() ?? "";
}

interface FamilyResolverOptions {
  /** Resolver-kind discriminator used in the mutex key so kinds never collide. */
  readonly kind: string;
  readonly activeResolverVersion: string;
  /** Find an existing family id for the active resolver version + normalized name. */
  readonly findIdByNormalizedName: (normalized: string) => Promise<string | undefined>;
  /** Mint a fresh canonical family row and return its id. */
  readonly createFamily: (displayName: string, normalized: string) => Promise<string>;
  /** Resolve a candidate id through the single-hop alias table. */
  readonly resolveAlias: (id: string) => Promise<string>;
}

/**
 * Shared core for the sponsor-family / underwriter-family resolvers: normalize ->
 * find-or-create at the active resolver version (serialized per key) -> alias
 * resolve. Name-only analogue of CompanyResolver's normalized-name fallback.
 */
export class FamilyResolver {
  private static readonly _keyMutexes = new Map<string, { mutex: AsyncMutex; refs: number }>();

  constructor(private opts: FamilyResolverOptions) {}

  async resolve(commonName: string): Promise<string> {
    const normalized = normalizeFamilyName(commonName);
    if (!normalized) {
      throw new Error(`cannot resolve ${this.opts.kind} family: empty common name`);
    }
    const key = `${this.opts.activeResolverVersion}|${this.opts.kind}-family|${normalized}`;

    let entry = FamilyResolver._keyMutexes.get(key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      FamilyResolver._keyMutexes.set(key, entry);
    }
    entry.refs += 1;

    let candidateId: string;
    try {
      candidateId = await entry.mutex.lock(async () => {
        const existing = await this.opts.findIdByNormalizedName(normalized);
        if (existing) return existing;
        return this.opts.createFamily(commonName, normalized);
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0 && FamilyResolver._keyMutexes.get(key) === entry) {
        FamilyResolver._keyMutexes.delete(key);
      }
    }

    return this.opts.resolveAlias(candidateId);
  }
}
