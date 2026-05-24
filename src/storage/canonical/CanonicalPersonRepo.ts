/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_PERSON_REPOSITORY_TOKEN,
  type CanonicalPerson,
  type CanonicalPersonRepositoryStorage,
} from "./CanonicalPersonSchema";

interface CanonicalPersonRepoOptions {
  canonicalPersonRepository?: CanonicalPersonRepositoryStorage;
}

/**
 * Manages canonical_person rows. Lookup methods are scoped by
 * `resolver_version` so multiple resolver versions can coexist during a
 * dev cycle without colliding. PersonResolver uses `findByResolverAndCik`
 * for the CIK fast-path and `findByResolverAndName` for the name+issuer
 * fallback.
 */
export class CanonicalPersonRepo {
  private repo: CanonicalPersonRepositoryStorage;

  constructor(options: CanonicalPersonRepoOptions = {}) {
    this.repo =
      options.canonicalPersonRepository ??
      globalServiceRegistry.get(CANONICAL_PERSON_REPOSITORY_TOKEN);
  }

  async create(row: CanonicalPerson): Promise<CanonicalPerson> {
    await this.repo.put(row);
    return row;
  }

  async getById(canonical_person_id: string): Promise<CanonicalPerson | undefined> {
    return await this.repo.get({ canonical_person_id });
  }

  async findByResolverAndCik(
    resolver_version: string,
    cik: number
  ): Promise<CanonicalPerson | undefined> {
    const matches = await this.repo.query({ resolver_version, cik });
    return matches?.[0];
  }

  async findByResolverAndName(
    resolver_version: string,
    normalized_first: string | null,
    normalized_middle: string | null,
    normalized_last: string | null,
    normalized_suffix: string | null,
    source_filing_issuer_cik: number | null
  ): Promise<CanonicalPerson | undefined> {
    const matches = await this.repo.query({
      resolver_version,
      normalized_first,
      normalized_middle,
      normalized_last,
      normalized_suffix,
      source_filing_issuer_cik,
    });
    return matches?.[0];
  }

  async listForResolverVersion(resolver_version: string): Promise<CanonicalPerson[]> {
    return (await this.repo.query({ resolver_version })) ?? [];
  }

  async deleteById(canonical_person_id: string): Promise<void> {
    await this.repo.delete({ canonical_person_id });
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({ canonical_person_id: r.canonical_person_id });
    }
    return rows.length;
  }

  async listAll(): Promise<CanonicalPerson[]> {
    return (await this.repo.getAll()) ?? [];
  }
}
