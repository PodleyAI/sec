/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
  type CanonicalSponsorFamilyAlias,
  type CanonicalSponsorFamilyAliasRepositoryStorage,
} from "./CanonicalAliasSchemas";

interface Options {
  repository?: CanonicalSponsorFamilyAliasRepositoryStorage;
}

export class CanonicalSponsorFamilyAliasRepo {
  private repo: CanonicalSponsorFamilyAliasRepositoryStorage;

  constructor(options: Options = {}) {
    this.repo =
      options.repository ??
      globalServiceRegistry.get(CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN);
  }

  async add(
    alias_canonical_id: string,
    target_canonical_id: string,
    reason: string | null,
    created_by: string | null
  ): Promise<CanonicalSponsorFamilyAlias> {
    if (alias_canonical_id === target_canonical_id) throw new Error("self-alias is not permitted");
    const targetAsAlias = await this.repo.get({ alias_canonical_id: target_canonical_id });
    if (targetAsAlias) {
      throw new Error(
        `single-hop invariant violated: target ${target_canonical_id} is itself an alias`
      );
    }
    const fromIsTarget = (await this.repo.query({ target_canonical_id: alias_canonical_id })) ?? [];
    if (fromIsTarget.length > 0) {
      throw new Error(
        `single-hop invariant violated: ${alias_canonical_id} is already a target of an existing alias`
      );
    }
    const row: CanonicalSponsorFamilyAlias = {
      alias_canonical_id,
      target_canonical_id,
      reason,
      created_at: new Date().toISOString(),
      created_by,
    };
    await this.repo.put(row);
    return row;
  }

  async remove(alias_canonical_id: string): Promise<void> {
    await this.repo.delete({ alias_canonical_id });
  }

  async resolve(canonical_id: string): Promise<string> {
    const row = await this.repo.get({ alias_canonical_id: canonical_id });
    return row?.target_canonical_id ?? canonical_id;
  }

  async list(): Promise<CanonicalSponsorFamilyAlias[]> {
    return (await this.repo.getAll()) ?? [];
  }

  /** Aliases that redirect into `target_canonical_id` (indexed lookup). */
  async listByTarget(target_canonical_id: string): Promise<CanonicalSponsorFamilyAlias[]> {
    return (await this.repo.query({ target_canonical_id })) ?? [];
  }

  async listOrphans(validIds: Set<string>): Promise<CanonicalSponsorFamilyAlias[]> {
    const all = await this.list();
    return all.filter(
      (a) => !validIds.has(a.alias_canonical_id) || !validIds.has(a.target_canonical_id)
    );
  }
}
