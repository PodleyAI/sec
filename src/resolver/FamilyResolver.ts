/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { companyFamilyName } from "../storage/company/CompanyFamilyName";
import { AsyncMutex } from "../util/AsyncMutex";
import { isUniqueConstraintError } from "../util/isUniqueConstraintError";

/**
 * The single source of truth for a family natural key (sponsor or underwriter).
 *
 * Derives the key from {@link companyFamilyName}, which drops the legal form
 * and the series marker that separate one vehicle from the next, then
 * UPPER-cases so matching is case-insensitive. Every caller that looks up a
 * family by name (resolver, CLI query, alias commands) MUST use this so keys
 * line up. Returns "" when the name yields nothing.
 *
 * Deriving it from the LEGAL name is what makes a family rebuildable. The key
 * previously came from `normalizeCompanyName`, which keeps the legal form, so
 * `Churchill Sponsor XIII LLC` and `Churchill Sponsor XIV LLC` were two
 * families and only the model's own "common name" could join them — which is
 * why batch `sec resolve` had to refuse family kinds. With the key computed
 * from a name every observation already carries, a re-partition is a
 * re-computation.
 *
 * What it deliberately does NOT do is fold business-line words: `Acme Capital`
 * and `Acme Ventures` stay two families, because they can be two firms. The
 * rare genuine join (`Chardan Capital Markets` → `Chardan`) is an alias, a
 * stated claim someone checked:
 *
 * ```sh
 * sec canonical underwriter-family alias "Chardan Capital Markets" "Chardan"
 * ```
 *
 * Case convention is UPPER and is locked in. Changing the fold re-partitions
 * existing `canonical_*_family.normalized_name` rows and orphans
 * operator-installed aliases, so it needs a resolver version bump and a
 * re-resolve, not a quiet edit. `FamilyResolver.test.ts` pins it.
 */
export function normalizeFamilyName(name: string): string {
  return companyFamilyName(name).toUpperCase();
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
 *
 * Concurrency: alias resolution runs INSIDE the per-key mutex so a concurrent
 * caller that queues behind us cannot observe the freshly-minted candidate
 * before the alias rewrite is applied. Without this, two parallel resolves on
 * the same family name could split: one returns the alias target, the other
 * returns the pre-alias id. Mirrors the {@link PersonResolver} /
 * {@link CompanyResolver} fix.
 *
 * The mutex map is instance-scoped (well, static-instance-scoped here): it
 * collapses intra-process contention on a shared key. Multi-process /
 * multi-instance contention is collapsed at the storage layer via the UNIQUE
 * index on (resolver_version, normalized_name) wired in DefaultDI /
 * TestingDI. When a concurrent writer in another process wins the UNIQUE
 * race, the loser's `createFamily` rejects with a UNIQUE constraint error;
 * the catch below re-queries `findIdByNormalizedName` and converges on the
 * winner's id rather than failing the resolve.
 */
export class FamilyResolver {
  private readonly _keyMutexes = new Map<string, { mutex: AsyncMutex; refs: number }>();

  constructor(private opts: FamilyResolverOptions) {}

  async resolve(commonName: string): Promise<string> {
    const normalized = normalizeFamilyName(commonName);
    if (!normalized) {
      throw new Error(`cannot resolve ${this.opts.kind} family: empty common name`);
    }
    const key = `${this.opts.activeResolverVersion}|${this.opts.kind}-family|${normalized}`;

    let entry = this._keyMutexes.get(key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      this._keyMutexes.set(key, entry);
    }
    entry.refs += 1;

    let resolvedId: string;
    try {
      resolvedId = await entry.mutex.lock(async () => {
        const existing = await this.opts.findIdByNormalizedName(normalized);
        let candidateId: string;
        if (existing !== undefined) {
          candidateId = existing;
        } else {
          try {
            candidateId = await this.opts.createFamily(commonName, normalized);
          } catch (err) {
            // A concurrent writer in a different process / resolver instance
            // won the UNIQUE constraint race. Re-query so we converge on the
            // winner's canonical family id instead of failing.
            if (!isUniqueConstraintError(err)) throw err;
            const winner = await this.opts.findIdByNormalizedName(normalized);
            if (winner === undefined) throw err;
            candidateId = winner;
          }
        }
        return await this.opts.resolveAlias(candidateId);
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0 && this._keyMutexes.get(key) === entry) {
        this._keyMutexes.delete(key);
      }
    }

    return resolvedId;
  }
}
