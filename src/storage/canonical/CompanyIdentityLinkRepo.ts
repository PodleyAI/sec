/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN,
  type CompanyIdentityLink,
  type CompanyIdentityLinkRepositoryStorage,
} from "./CompanyIdentityLinkSchema";

interface CompanyIdentityLinkRepoOptions {
  companyIdentityLinkRepository?: CompanyIdentityLinkRepositoryStorage;
}

export class CompanyIdentityLinkRepo {
  private repo: CompanyIdentityLinkRepositoryStorage;

  constructor(options: CompanyIdentityLinkRepoOptions = {}) {
    this.repo =
      options.companyIdentityLinkRepository ??
      globalServiceRegistry.get(COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN);
  }

  async upsert(
    observation_id: number,
    resolver_version: string,
    canonical_company_id: string,
    created_at: string = new Date().toISOString()
  ): Promise<CompanyIdentityLink> {
    const row: CompanyIdentityLink = {
      observation_id,
      resolver_version,
      canonical_company_id,
      created_at,
    };
    await this.repo.put(row);
    return row;
  }

  async getForObservation(
    observation_id: number,
    resolver_version: string
  ): Promise<CompanyIdentityLink | undefined> {
    return await this.repo.get({ observation_id, resolver_version });
  }

  async listForCanonical(
    canonical_company_id: string,
    resolver_version: string
  ): Promise<CompanyIdentityLink[]> {
    return (
      (await this.repo.query({ canonical_company_id, resolver_version })) ?? []
    );
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        observation_id: r.observation_id,
        resolver_version: r.resolver_version,
      });
    }
    return rows.length;
  }

  async listAll(): Promise<CompanyIdentityLink[]> {
    return (await this.repo.getAll()) ?? [];
  }
}
