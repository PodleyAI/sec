/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_COMPANY_REPOSITORY_TOKEN,
  type CanonicalCompany,
  type CanonicalCompanyRepositoryStorage,
} from "./CanonicalCompanySchema";

interface CanonicalCompanyRepoOptions {
  canonicalCompanyRepository?: CanonicalCompanyRepositoryStorage;
}

/**
 * Manages canonical_company rows. Lookup methods are scoped by `resolver_version`
 * so multiple resolver versions can coexist. CompanyResolver uses the CIK → CRD →
 * normalized-name cascade via `findByResolverAnd*` methods.
 */
export class CanonicalCompanyRepo {
  private repo: CanonicalCompanyRepositoryStorage;

  constructor(options: CanonicalCompanyRepoOptions = {}) {
    this.repo =
      options.canonicalCompanyRepository ??
      globalServiceRegistry.get(CANONICAL_COMPANY_REPOSITORY_TOKEN);
  }

  get storage(): CanonicalCompanyRepositoryStorage {
    return this.repo;
  }

  async create(row: CanonicalCompany): Promise<CanonicalCompany> {
    await this.repo.put(row);
    return row;
  }

  async getById(canonical_company_id: string): Promise<CanonicalCompany | undefined> {
    return await this.repo.get({ canonical_company_id });
  }

  async findByResolverAndCik(
    resolver_version: string,
    cik: number
  ): Promise<CanonicalCompany | undefined> {
    const matches = await this.repo.query({ resolver_version, cik });
    return matches?.[0];
  }

  async findByResolverAndCrd(
    resolver_version: string,
    crd_number: string
  ): Promise<CanonicalCompany | undefined> {
    const matches = await this.repo.query({ resolver_version, crd_number });
    return matches?.[0];
  }

  async findByResolverAndName(
    resolver_version: string,
    normalized_name: string
  ): Promise<CanonicalCompany | undefined> {
    const matches = await this.repo.query({ resolver_version, normalized_name });
    return matches?.[0];
  }

  async listForResolverVersion(resolver_version: string): Promise<CanonicalCompany[]> {
    return (await this.repo.query({ resolver_version })) ?? [];
  }

  async deleteById(canonical_company_id: string): Promise<void> {
    await this.repo.delete({ canonical_company_id });
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({ canonical_company_id: r.canonical_company_id });
    }
    return rows.length;
  }

  async listAll(): Promise<CanonicalCompany[]> {
    return (await this.repo.getAll()) ?? [];
  }
}
