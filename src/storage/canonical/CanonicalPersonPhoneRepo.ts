/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
  type CanonicalPersonPhone,
  type CanonicalPersonPhoneRepositoryStorage,
} from "./CanonicalJunctionSchemas";

interface CanonicalPersonPhoneRepoOptions {
  canonicalPersonPhoneRepository?: CanonicalPersonPhoneRepositoryStorage;
}

interface RecordPersonPhoneArgs {
  canonical_person_id: string;
  international_number: string;
  resolver_version: string;
  seen_at: string;
}

export class CanonicalPersonPhoneRepo {
  private repo: CanonicalPersonPhoneRepositoryStorage;

  constructor(options: CanonicalPersonPhoneRepoOptions = {}) {
    this.repo =
      options.canonicalPersonPhoneRepository ??
      globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN);
  }

  async recordObservation(args: RecordPersonPhoneArgs): Promise<CanonicalPersonPhone> {
    const pk = {
      canonical_person_id: args.canonical_person_id,
      international_number: args.international_number,
      resolver_version: args.resolver_version,
    };
    const existing = await this.repo.get(pk);
    if (existing) {
      const updated: CanonicalPersonPhone = {
        ...existing,
        observation_count: existing.observation_count + 1,
        last_seen_at: args.seen_at,
      };
      await this.repo.put(updated);
      return updated;
    }
    const fresh: CanonicalPersonPhone = {
      ...pk,
      observation_count: 1,
      first_seen_at: args.seen_at,
      last_seen_at: args.seen_at,
    };
    await this.repo.put(fresh);
    return fresh;
  }

  async listForCanonical(
    canonical_person_id: string,
    resolver_version: string
  ): Promise<CanonicalPersonPhone[]> {
    return (await this.repo.query({ canonical_person_id, resolver_version })) ?? [];
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        canonical_person_id: r.canonical_person_id,
        international_number: r.international_number,
        resolver_version: r.resolver_version,
      });
    }
    return rows.length;
  }
}
