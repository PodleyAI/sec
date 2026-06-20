/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import type { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import type { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import type { PersonObservation } from "../storage/observation/PersonObservationSchema";
import type { CanonicalPerson } from "../storage/canonical/CanonicalPersonSchema";
import { AsyncMutex } from "../util/AsyncMutex";
import { isUniqueConstraintError } from "./isUniqueConstraintError";

interface PersonResolverOptions {
  canonicalPersonRepo: CanonicalPersonRepo;
  canonicalPersonAliasRepo: CanonicalPersonAliasRepo;
  activeResolverVersion: string;
}

function personKey(obs: PersonObservation, resolverVersion: string): string {
  if (obs.cik !== null && obs.cik !== undefined) {
    return `${resolverVersion}|cik|${obs.cik}`;
  }
  // Match findByResolverAndName's lookup tuple. The issuer CIK is part of
  // the key so two filings that mention the same normalized name from
  // different issuers do not collide.
  return [
    resolverVersion,
    "name",
    obs.normalized_first ?? "",
    obs.normalized_middle ?? "",
    obs.normalized_last ?? "",
    obs.normalized_suffix ?? "",
    obs.source_filing_issuer_cik ?? "",
  ].join("|");
}

/**
 * Matches a PersonObservation to an existing canonical person or creates one.
 * Resolution order: CIK fast-path, then normalized-name + issuer-CIK fallback.
 * Delegates alias indirection to CanonicalPersonAliasRepo.
 *
 * Concurrency: two `resolve()` calls that map to the same (resolver_version,
 * key_kind, key_value) used to race — both observed no canonical row, both
 * minted a fresh UUID, both inserted, yielding two distinct canonical ids
 * for what should have been the same person. We now serialise the
 * find-or-create critical section per key with an `AsyncMutex`,
 * kept alive for as long as any caller still holds or is queued behind it
 * via a simple refcount. Once the count drops to zero the entry is
 * removed from the map so the map stays bounded for long-running
 * processes that resolve millions of distinct keys.
 *
 * The alias-resolution lookup also runs inside the mutex so the queued
 * caller observes both the canonical row and its alias resolution, so
 * concurrent resolves converge to the same final canonical_person_id
 * even when one races an alias rewrite that happens between the create
 * and the alias lookup.
 *
 * The mutex map is instance-scoped: intra-instance contention is
 * serialised via per-key mutexes; multi-instance / multi-process
 * contention is collapsed at the storage layer via UNIQUE constraints on
 * (resolver_version, cik). Every production call site constructs one
 * resolver and reuses it for the duration of its work (a filing
 * extraction, a CLI batch resolve), so intra-instance serialisation
 * covers all observations sharing a scope.
 */
export class PersonResolver {
  private readonly _keyMutexes = new Map<
    string,
    { mutex: AsyncMutex; refs: number }
  >();

  constructor(private opts: PersonResolverOptions) {}

  async resolve(obs: PersonObservation): Promise<string> {
    const key = personKey(obs, this.opts.activeResolverVersion);
    let entry = this._keyMutexes.get(key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      this._keyMutexes.set(key, entry);
    }
    entry.refs += 1;

    let resolvedId: string;
    try {
      resolvedId = await entry.mutex.lock(async () => {
        // Inside the critical section we re-query so any queued caller
        // that ran before us picks up the canonical row they just
        // inserted.
        let candidate: CanonicalPerson | undefined;
        if (obs.cik !== null && obs.cik !== undefined) {
          candidate = await this.opts.canonicalPersonRepo.findByResolverAndCik(
            this.opts.activeResolverVersion,
            obs.cik
          );
        } else {
          candidate = await this.opts.canonicalPersonRepo.findByResolverAndName(
            this.opts.activeResolverVersion,
            obs.normalized_first,
            obs.normalized_middle,
            obs.normalized_last,
            obs.normalized_suffix,
            obs.source_filing_issuer_cik
          );
        }
        let candidateId: string;
        if (candidate) {
          candidateId = candidate.canonical_person_id;
        } else {
          const freshId = randomUUID();
          const fresh: CanonicalPerson = {
            canonical_person_id: freshId,
            resolver_version: this.opts.activeResolverVersion,
            display_first: obs.first_name,
            display_middle: obs.middle_name,
            display_last: obs.last_name,
            display_suffix: obs.suffix,
            cik: obs.cik,
            normalized_first: obs.normalized_first,
            normalized_middle: obs.normalized_middle,
            normalized_last: obs.normalized_last,
            normalized_suffix: obs.normalized_suffix,
            source_filing_issuer_cik:
              obs.cik === null ? obs.source_filing_issuer_cik : null,
            created_at: new Date().toISOString(),
          };
          try {
            await this.opts.canonicalPersonRepo.create(fresh);
            candidateId = freshId;
          } catch (err) {
            // A concurrent writer in a different process / resolver
            // instance won the UNIQUE constraint race. Re-query so we
            // converge on the winner's canonical id instead of failing.
            if (!isUniqueConstraintError(err)) throw err;
            let winner: CanonicalPerson | undefined;
            if (obs.cik !== null && obs.cik !== undefined) {
              winner = await this.opts.canonicalPersonRepo.findByResolverAndCik(
                this.opts.activeResolverVersion,
                obs.cik
              );
            } else {
              winner = await this.opts.canonicalPersonRepo.findByResolverAndName(
                this.opts.activeResolverVersion,
                obs.normalized_first,
                obs.normalized_middle,
                obs.normalized_last,
                obs.normalized_suffix,
                obs.source_filing_issuer_cik
              );
            }
            if (winner === undefined) throw err;
            candidateId = winner.canonical_person_id;
          }
        }
        // Resolve the alias INSIDE the mutex so a concurrent caller that
        // queues behind us cannot observe the freshly-minted candidate
        // before the alias rewrite is applied. Without this, two parallel
        // resolves could split: one returns the alias target, the other
        // returns the pre-alias id.
        return await this.opts.canonicalPersonAliasRepo.resolve(candidateId);
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0) {
        // Same identity check guards against a race where another caller
        // recreated the entry after we decremented but before this line.
        const current = this._keyMutexes.get(key);
        if (current === entry) {
          this._keyMutexes.delete(key);
        }
      }
    }

    return resolvedId;
  }
}
