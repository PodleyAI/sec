/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
  type CanonicalCompanyPhone,
  type CanonicalCompanyPhoneRepositoryStorage,
} from "./CanonicalJunctionSchemas";

interface CanonicalCompanyPhoneRepoOptions {
  canonicalCompanyPhoneRepository?: CanonicalCompanyPhoneRepositoryStorage;
}

interface RecordCompanyPhoneArgs {
  canonical_company_id: string;
  international_number: string;
  resolver_version: string;
  seen_at: string;
}

export class CanonicalCompanyPhoneRepo {
  private repo: CanonicalCompanyPhoneRepositoryStorage;

  constructor(options: CanonicalCompanyPhoneRepoOptions = {}) {
    this.repo =
      options.canonicalCompanyPhoneRepository ??
      globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN);
  }

  async recordObservation(args: RecordCompanyPhoneArgs): Promise<CanonicalCompanyPhone> {
    const pk = {
      canonical_company_id: args.canonical_company_id,
      international_number: args.international_number,
      resolver_version: args.resolver_version,
    };
    const existing = await this.repo.get(pk);
    if (existing) {
      const updated: CanonicalCompanyPhone = {
        ...existing,
        observation_count: existing.observation_count + 1,
        last_seen_at: args.seen_at,
      };
      await this.repo.put(updated);
      return updated;
    }
    const fresh: CanonicalCompanyPhone = {
      ...pk,
      observation_count: 1,
      first_seen_at: args.seen_at,
      last_seen_at: args.seen_at,
    };
    await this.repo.put(fresh);
    return fresh;
  }

  async listForCanonical(
    canonical_company_id: string,
    resolver_version: string
  ): Promise<CanonicalCompanyPhone[]> {
    return (await this.repo.query({ canonical_company_id, resolver_version })) ?? [];
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        canonical_company_id: r.canonical_company_id,
        international_number: r.international_number,
        resolver_version: r.resolver_version,
      });
    }
    return rows.length;
  }
}
