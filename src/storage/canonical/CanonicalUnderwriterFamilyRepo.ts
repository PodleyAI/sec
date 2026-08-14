/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN,
  type CanonicalUnderwriterFamily,
  type CanonicalUnderwriterFamilyRepositoryStorage,
} from "./CanonicalUnderwriterFamilySchema";

export class CanonicalUnderwriterFamilyRepo {
  private repo: CanonicalUnderwriterFamilyRepositoryStorage;

  constructor(repo?: CanonicalUnderwriterFamilyRepositoryStorage) {
    this.repo = repo ?? globalServiceRegistry.get(CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN);
  }

  async create(row: CanonicalUnderwriterFamily): Promise<CanonicalUnderwriterFamily> {
    await this.repo.put(row);
    return row;
  }

  async getById(
    canonical_underwriter_family_id: string
  ): Promise<CanonicalUnderwriterFamily | undefined> {
    return this.repo.get({ canonical_underwriter_family_id });
  }

  async findByResolverAndName(
    resolver_version: string,
    normalized_name: string
  ): Promise<CanonicalUnderwriterFamily | undefined> {
    const matches = await this.repo.query({ resolver_version, normalized_name });
    return matches?.[0];
  }

  /**
   * Every family row, across resolver versions. Alias rows are not
   * version-scoped, so resolving an alias id to its display name cannot be
   * either — a listing scoped to one version would print blanks for the
   * aliases an operator most needs to see.
   */
  async listAll(): Promise<CanonicalUnderwriterFamily[]> {
    return (await this.repo.getAll()) ?? [];
  }

  async listForResolverVersion(resolver_version: string): Promise<CanonicalUnderwriterFamily[]> {
    return (await this.repo.query({ resolver_version })) ?? [];
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows)
      await this.repo.delete({
        canonical_underwriter_family_id: r.canonical_underwriter_family_id,
      });
    return rows.length;
  }
}
