/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { KeyedMutex } from "../../util/KeyedMutex";
import {
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
  type CanonicalPersonAddress,
  type CanonicalPersonAddressRepositoryStorage,
} from "./CanonicalJunctionSchemas";

interface CanonicalPersonAddressRepoOptions {
  canonicalPersonAddressRepository?: CanonicalPersonAddressRepositoryStorage;
}

interface RecordPersonAddressArgs {
  canonical_person_id: string;
  address_hash_id: string;
  resolver_version: string;
  seen_at: string;
}

/**
 * Serialises the read-modify-write of the mutable `observation_count` per
 * composite PK `(canonical_person_id, address_hash_id, resolver_version)`.
 * Module-scoped because every caller builds a fresh {@link CanonicalPersonAddressRepo};
 * different composite keys still run concurrently. The `\x00` separator never
 * occurs in the string PK components, so distinct keys can't collide.
 */
const junctionLocks = new KeyedMutex<string>();

function junctionKey(pk: {
  canonical_person_id: string;
  address_hash_id: string;
  resolver_version: string;
}): string {
  return `${pk.canonical_person_id}\x00${pk.address_hash_id}\x00${pk.resolver_version}`;
}

export class CanonicalPersonAddressRepo {
  private repo: CanonicalPersonAddressRepositoryStorage;

  constructor(options: CanonicalPersonAddressRepoOptions = {}) {
    this.repo =
      options.canonicalPersonAddressRepository ??
      globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN);
  }

  async recordObservation(args: RecordPersonAddressArgs): Promise<CanonicalPersonAddress> {
    const pk = {
      canonical_person_id: args.canonical_person_id,
      address_hash_id: args.address_hash_id,
      resolver_version: args.resolver_version,
    };
    return junctionLocks.lock(junctionKey(pk), async () => {
      const existing = await this.repo.get(pk);
      if (existing) {
        const updated: CanonicalPersonAddress = {
          ...existing,
          observation_count: existing.observation_count + 1,
          last_seen_at: args.seen_at,
        };
        await this.repo.put(updated);
        return updated;
      }
      const fresh: CanonicalPersonAddress = {
        ...pk,
        observation_count: 1,
        first_seen_at: args.seen_at,
        last_seen_at: args.seen_at,
      };
      await this.repo.put(fresh);
      return fresh;
    });
  }

  /**
   * Remove one observation's contribution: decrement the co-occurrence count,
   * deleting the row when it reaches zero. The inverse of {@link recordObservation},
   * used when an observation is reaped (orphan) or re-observed (idempotent replay)
   * so the count tracks live observations rather than blindly accumulating.
   */
  async removeObservation(pk: {
    canonical_person_id: string;
    address_hash_id: string;
    resolver_version: string;
  }): Promise<void> {
    await junctionLocks.lock(junctionKey(pk), async () => {
      const existing = await this.repo.get(pk);
      if (!existing) return;
      if (existing.observation_count <= 1) {
        await this.repo.delete(pk);
        return;
      }
      await this.repo.put({ ...existing, observation_count: existing.observation_count - 1 });
    });
  }

  async listForCanonical(
    canonical_person_id: string,
    resolver_version: string
  ): Promise<CanonicalPersonAddress[]> {
    return (await this.repo.query({ canonical_person_id, resolver_version })) ?? [];
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        canonical_person_id: r.canonical_person_id,
        address_hash_id: r.address_hash_id,
        resolver_version: r.resolver_version,
      });
    }
    return rows.length;
  }
}
