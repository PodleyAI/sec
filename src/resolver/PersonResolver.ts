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
 * find-or-create critical section per key with a process-wide `AsyncMutex`,
 * kept alive for as long as any caller still holds or is queued behind it
 * via a simple refcount. Once the count drops to zero the entry is
 * removed from the map so the map stays bounded for long-running
 * processes that resolve millions of distinct keys.
 *
 * Multi-process callers (workers, separate `sec` invocations) still need
 * a backend-level UNIQUE constraint to be race-free — single-process
 * mutexes are not visible to other processes.
 */
export class PersonResolver {
  private static readonly _keyMutexes = new Map<
    string,
    { mutex: AsyncMutex; refs: number }
  >();

  constructor(private opts: PersonResolverOptions) {}

  async resolve(obs: PersonObservation): Promise<string> {
    const key = personKey(obs, this.opts.activeResolverVersion);
    let entry = PersonResolver._keyMutexes.get(key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      PersonResolver._keyMutexes.set(key, entry);
    }
    entry.refs += 1;

    let candidateId: string;
    try {
      candidateId = await entry.mutex.lock(async () => {
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
        if (candidate) {
          return candidate.canonical_person_id;
        }
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
        await this.opts.canonicalPersonRepo.create(fresh);
        return freshId;
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0) {
        // Same identity check guards against a race where another caller
        // recreated the entry after we decremented but before this line.
        const current = PersonResolver._keyMutexes.get(key);
        if (current === entry) {
          PersonResolver._keyMutexes.delete(key);
        }
      }
    }

    return await this.opts.canonicalPersonAliasRepo.resolve(candidateId);
  }
}
