/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN,
  type CanonicalSponsorFamily,
  type CanonicalSponsorFamilyRepositoryStorage,
} from "./CanonicalSponsorFamilySchema";

export class CanonicalSponsorFamilyRepo {
  private repo: CanonicalSponsorFamilyRepositoryStorage;

  constructor(repo?: CanonicalSponsorFamilyRepositoryStorage) {
    this.repo = repo ?? globalServiceRegistry.get(CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN);
  }

  async create(row: CanonicalSponsorFamily): Promise<CanonicalSponsorFamily> {
    await this.repo.put(row);
    return row;
  }

  async getById(canonical_sponsor_family_id: string): Promise<CanonicalSponsorFamily | undefined> {
    return this.repo.get({ canonical_sponsor_family_id });
  }

  async findByResolverAndName(
    resolver_version: string,
    normalized_name: string
  ): Promise<CanonicalSponsorFamily | undefined> {
    const matches = await this.repo.query({ resolver_version, normalized_name });
    return matches?.[0];
  }

  async listForResolverVersion(resolver_version: string): Promise<CanonicalSponsorFamily[]> {
    return (await this.repo.query({ resolver_version })) ?? [];
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows)
      await this.repo.delete({ canonical_sponsor_family_id: r.canonical_sponsor_family_id });
    return rows.length;
  }
}
