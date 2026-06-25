/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
  type CanonicalCompanyAddress,
  type CanonicalCompanyAddressRepositoryStorage,
} from "./CanonicalJunctionSchemas";

interface CanonicalCompanyAddressRepoOptions {
  canonicalCompanyAddressRepository?: CanonicalCompanyAddressRepositoryStorage;
}

interface RecordCompanyAddressArgs {
  canonical_company_id: string;
  address_hash_id: string;
  resolver_version: string;
  seen_at: string;
}

export class CanonicalCompanyAddressRepo {
  private repo: CanonicalCompanyAddressRepositoryStorage;

  constructor(options: CanonicalCompanyAddressRepoOptions = {}) {
    this.repo =
      options.canonicalCompanyAddressRepository ??
      globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN);
  }

  async recordObservation(args: RecordCompanyAddressArgs): Promise<CanonicalCompanyAddress> {
    const pk = {
      canonical_company_id: args.canonical_company_id,
      address_hash_id: args.address_hash_id,
      resolver_version: args.resolver_version,
    };
    const existing = await this.repo.get(pk);
    if (existing) {
      const updated: CanonicalCompanyAddress = {
        ...existing,
        observation_count: existing.observation_count + 1,
        last_seen_at: args.seen_at,
      };
      await this.repo.put(updated);
      return updated;
    }
    const fresh: CanonicalCompanyAddress = {
      ...pk,
      observation_count: 1,
      first_seen_at: args.seen_at,
      last_seen_at: args.seen_at,
    };
    await this.repo.put(fresh);
    return fresh;
  }

  /** Remove one observation's contribution; see CanonicalPersonAddressRepo.removeObservation. */
  async removeObservation(pk: {
    canonical_company_id: string;
    address_hash_id: string;
    resolver_version: string;
  }): Promise<void> {
    const existing = await this.repo.get(pk);
    if (!existing) return;
    if (existing.observation_count <= 1) {
      await this.repo.delete(pk);
      return;
    }
    await this.repo.put({ ...existing, observation_count: existing.observation_count - 1 });
  }

  async listForCanonical(
    canonical_company_id: string,
    resolver_version: string
  ): Promise<CanonicalCompanyAddress[]> {
    return (await this.repo.query({ canonical_company_id, resolver_version })) ?? [];
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        canonical_company_id: r.canonical_company_id,
        address_hash_id: r.address_hash_id,
        resolver_version: r.resolver_version,
      });
    }
    return rows.length;
  }
}
