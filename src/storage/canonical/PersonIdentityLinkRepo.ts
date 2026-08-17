/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import {
  PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
  type PersonIdentityLink,
  type PersonIdentityLinkRepositoryStorage,
} from "./PersonIdentityLinkSchema";

interface PersonIdentityLinkRepoOptions {
  personIdentityLinkRepository?: PersonIdentityLinkRepositoryStorage;
}

/**
 * Links person observation rows to canonical person rows at a specific
 * `resolver_version`. The composite primary key is `(observation_id, resolver_version)`.
 */
export class PersonIdentityLinkRepo {
  private repo: PersonIdentityLinkRepositoryStorage;

  constructor(options: PersonIdentityLinkRepoOptions = {}) {
    this.repo =
      options.personIdentityLinkRepository ??
      globalServiceRegistry.get(PERSON_IDENTITY_LINK_REPOSITORY_TOKEN);
  }

  async upsert(
    observation_id: number,
    resolver_version: string,
    canonical_person_id: string,
    created_at: string = new Date().toISOString()
  ): Promise<PersonIdentityLink> {
    const row: PersonIdentityLink = {
      observation_id,
      resolver_version,
      canonical_person_id,
      created_at,
    };
    await this.repo.put(row);
    return row;
  }

  async getForObservation(
    observation_id: number,
    resolver_version: string
  ): Promise<PersonIdentityLink | undefined> {
    return await this.repo.get({ observation_id, resolver_version });
  }

  /** All links for an observation across resolver versions. */
  async listForObservation(observation_id: number): Promise<PersonIdentityLink[]> {
    return (await this.repo.query({ observation_id })) ?? [];
  }

  /** Delete every link for an observation (all resolver versions) — used when the
   * underlying observation row is reaped so no link is left dangling. */
  async deleteForObservation(observation_id: number): Promise<void> {
    const rows = (await this.repo.query({ observation_id })) ?? [];
    for (const r of rows) {
      await this.repo.delete({
        observation_id: r.observation_id,
        resolver_version: r.resolver_version,
      });
    }
  }

  async listForCanonical(
    canonical_person_id: string,
    resolver_version: string
  ): Promise<PersonIdentityLink[]> {
    return (await this.repo.query({ canonical_person_id, resolver_version })) ?? [];
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

  async listAll(): Promise<PersonIdentityLink[]> {
    return (await this.repo.getAll()) ?? [];
  }

  /**
   * Pass-through to the underlying tabular storage's COUNT path. Callers
   * must prefer this over `(await listAll()).length` at scale.
   */
  async count(criteria?: SearchCriteria<PersonIdentityLink>): Promise<number> {
    return await this.repo.count(criteria);
  }
}
