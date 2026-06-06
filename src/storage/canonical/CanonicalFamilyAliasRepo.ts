/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "workglow";

/**
 * Structural shape shared by the sponsor-family and underwriter-family alias
 * rows. Both schemas are identical, so a single row type drives the base.
 */
export interface FamilyAliasRow {
  readonly alias_canonical_id: string;
  readonly target_canonical_id: string;
  readonly reason: string | null;
  readonly created_at: string;
  readonly created_by: string | null;
}

type FamilyAliasStorage = ITabularStorage<any, any, FamilyAliasRow>;

/**
 * Shared single-hop alias logic for the family canonical tiers (sponsor /
 * underwriter). Holds `add`/`remove`/`resolve`/`list`/`listByTarget`/
 * `listOrphans`; subclasses only supply the backing storage instance.
 */
export class CanonicalFamilyAliasRepo {
  protected repo: FamilyAliasStorage;

  constructor(repo: FamilyAliasStorage) {
    this.repo = repo;
  }

  async add(
    alias_canonical_id: string,
    target_canonical_id: string,
    reason: string | null,
    created_by: string | null
  ): Promise<FamilyAliasRow> {
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
    const row: FamilyAliasRow = {
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

  async list(): Promise<FamilyAliasRow[]> {
    return (await this.repo.getAll()) ?? [];
  }

  /** Aliases that redirect into `target_canonical_id` (indexed lookup). */
  async listByTarget(target_canonical_id: string): Promise<FamilyAliasRow[]> {
    return (await this.repo.query({ target_canonical_id })) ?? [];
  }

  async listOrphans(validIds: Set<string>): Promise<FamilyAliasRow[]> {
    const all = await this.list();
    return all.filter(
      (a) => !validIds.has(a.alias_canonical_id) || !validIds.has(a.target_canonical_id)
    );
  }
}
