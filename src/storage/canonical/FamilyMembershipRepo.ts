/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "workglow";

/**
 * Structural shape shared by sponsor-family and underwriter-family membership
 * rows. The family-id column name differs between the two tiers, so it is
 * addressed dynamically via the `familyIdColumn` constructor argument.
 */
export interface FamilyMembershipRow {
  readonly resolver_version: string;
  readonly canonical_company_id: string;
  readonly seen_at: string;
  readonly [familyIdColumn: string]: string;
}

type FamilyMembershipStorage = ITabularStorage<any, any, FamilyMembershipRow>;

/**
 * Shared co-occurrence membership logic for the family canonical tiers. The
 * family-id column name (`canonical_sponsor_family_id` /
 * `canonical_underwriter_family_id`) is injected so the same body serves both.
 */
export class FamilyMembershipRepo<TRow extends FamilyMembershipRow> {
  protected repo: ITabularStorage<any, any, TRow>;
  private readonly familyIdColumn: string;

  constructor(repo: ITabularStorage<any, any, TRow>, familyIdColumn: string) {
    this.repo = repo;
    this.familyIdColumn = familyIdColumn;
  }

  async record(row: TRow): Promise<void> {
    await this.repo.put(row); // PK upsert -> idempotent
  }

  async listCompaniesForFamily(resolver_version: string, family_id: string): Promise<string[]> {
    const rows =
      (await this.repo.query({ resolver_version, [this.familyIdColumn]: family_id } as any)) ?? [];
    return rows.map((r) => r.canonical_company_id);
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version } as any)) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        resolver_version: r.resolver_version,
        canonical_company_id: r.canonical_company_id,
        [this.familyIdColumn]: (r as any)[this.familyIdColumn],
      } as any);
    }
    return rows.length;
  }
}
