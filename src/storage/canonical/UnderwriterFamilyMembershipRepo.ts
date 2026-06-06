/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
  type UnderwriterFamilyMembership,
  type UnderwriterFamilyMembershipRepositoryStorage,
} from "./UnderwriterFamilyMembershipSchema";

export class UnderwriterFamilyMembershipRepo {
  private repo: UnderwriterFamilyMembershipRepositoryStorage;

  constructor(repo?: UnderwriterFamilyMembershipRepositoryStorage) {
    this.repo = repo ?? globalServiceRegistry.get(UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN);
  }

  async record(row: UnderwriterFamilyMembership): Promise<void> {
    await this.repo.put(row); // PK upsert -> idempotent
  }

  async listCompaniesForFamily(
    resolver_version: string,
    canonical_underwriter_family_id: string
  ): Promise<string[]> {
    const rows =
      (await this.repo.query({ resolver_version, canonical_underwriter_family_id })) ?? [];
    return rows.map((r) => r.canonical_company_id);
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        resolver_version: r.resolver_version,
        canonical_company_id: r.canonical_company_id,
        canonical_underwriter_family_id: r.canonical_underwriter_family_id,
      });
    }
    return rows.length;
  }
}
