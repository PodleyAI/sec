/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
  type CanonicalPersonAlias,
  type CanonicalPersonAliasRepositoryStorage,
} from "./CanonicalAliasSchemas";

interface CanonicalPersonAliasRepoOptions {
  canonicalPersonAliasRepository?: CanonicalPersonAliasRepositoryStorage;
}

export class CanonicalPersonAliasRepo {
  private repo: CanonicalPersonAliasRepositoryStorage;

  constructor(options: CanonicalPersonAliasRepoOptions = {}) {
    this.repo =
      options.canonicalPersonAliasRepository ??
      globalServiceRegistry.get(CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN);
  }

  async add(
    alias_canonical_id: string,
    target_canonical_id: string,
    reason: string | null,
    created_by: string | null
  ): Promise<CanonicalPersonAlias> {
    if (alias_canonical_id === target_canonical_id) {
      throw new Error("self-alias is not permitted");
    }
    const targetAsAlias = await this.repo.get({
      alias_canonical_id: target_canonical_id,
    });
    if (targetAsAlias) {
      throw new Error(
        `single-hop invariant violated: target ${target_canonical_id} is itself an alias`
      );
    }
    const row: CanonicalPersonAlias = {
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

  async list(): Promise<CanonicalPersonAlias[]> {
    return (await this.repo.getAll()) ?? [];
  }

  async listOrphans(validIds: Set<string>): Promise<CanonicalPersonAlias[]> {
    const all = await this.list();
    return all.filter(
      (a) => !validIds.has(a.alias_canonical_id) || !validIds.has(a.target_canonical_id)
    );
  }
}
