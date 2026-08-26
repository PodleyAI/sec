/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "workglow";
import { KeyedMutex } from "../../util/KeyedMutex";

/**
 * Structural shape shared by the four canonical address/phone junction rows.
 * The two composite-PK columns (`canonical_{person,company}_id` and
 * `address_hash_id` / `international_number`) differ per table, so they are
 * addressed dynamically via the constructor's `idColumn` / `assocColumn`.
 */
export interface CanonicalJunctionRow {
  readonly resolver_version: string;
  readonly observation_count: number;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
}

/**
 * One process-wide lock map for every junction table. Keys are namespaced by
 * `kind` so distinct tables never contend, and the `\x00` separator can't occur
 * in a UUID / address-hash / E.164 number / semver, so distinct composite PKs
 * can't collide. Each key's mutex is refcounted and evicted at zero, so the map
 * stays bounded under a long-lived process.
 */
const junctionLocks = new KeyedMutex<string>();

/**
 * Shared co-occurrence logic for the canonical address/phone junction tiers: a
 * per-composite-PK serialised read-modify-write of the mutable
 * `observation_count`, plus the version-scoped list/purge queries. The row type
 * and the two PK column names are injected so one body serves all four
 * `Canonical{Person,Company}{Address,Phone}Repo` subclasses — a fix here (lock
 * key, count math, delete-at-zero) applies to every junction table at once.
 *
 * Single-process only (see {@link KeyedMutex}): multi-process callers still rely
 * on the backend PK for row-creation race-freedom.
 */
export class CanonicalJunctionRepo<TRow extends CanonicalJunctionRow> {
  protected readonly repo: ITabularStorage<any, any, TRow>;
  private readonly kind: string;
  private readonly idColumn: string;
  private readonly assocColumn: string;

  constructor(
    repo: ITabularStorage<any, any, TRow>,
    kind: string,
    idColumn: string,
    assocColumn: string
  ) {
    this.repo = repo;
    this.kind = kind;
    this.idColumn = idColumn;
    this.assocColumn = assocColumn;
  }

  private pk(
    idValue: string,
    assocValue: string,
    resolver_version: string
  ): Record<string, string> {
    return {
      [this.idColumn]: idValue,
      [this.assocColumn]: assocValue,
      resolver_version,
    };
  }

  private lockKey(idValue: string, assocValue: string, resolver_version: string): string {
    return `${this.kind}\x00${idValue}\x00${assocValue}\x00${resolver_version}`;
  }

  /**
   * Record one observation's contribution: increment the co-occurrence count
   * (creating the row on first sight), serialised per composite PK so concurrent
   * observers of the same key can't lose an increment.
   */
  protected record(
    idValue: string,
    assocValue: string,
    resolver_version: string,
    seen_at: string
  ): Promise<TRow> {
    const pk = this.pk(idValue, assocValue, resolver_version);
    return junctionLocks.lock(this.lockKey(idValue, assocValue, resolver_version), async () => {
      const existing = await this.repo.get(pk as any);
      if (existing) {
        const updated = {
          ...existing,
          observation_count: existing.observation_count + 1,
          last_seen_at: seen_at,
        } as TRow;
        await this.repo.put(updated);
        return updated;
      }
      const fresh = {
        ...pk,
        observation_count: 1,
        first_seen_at: seen_at,
        last_seen_at: seen_at,
      } as unknown as TRow;
      await this.repo.put(fresh);
      return fresh;
    });
  }

  /**
   * Remove one observation's contribution: decrement, deleting the row when it
   * reaches zero. The inverse of {@link record}, used when an observation is
   * reaped (orphan) or re-observed (idempotent replay) so the count tracks live
   * observations rather than blindly accumulating. Serialised per PK.
   */
  protected remove(idValue: string, assocValue: string, resolver_version: string): Promise<void> {
    const pk = this.pk(idValue, assocValue, resolver_version);
    return junctionLocks.lock(this.lockKey(idValue, assocValue, resolver_version), async () => {
      const existing = await this.repo.get(pk as any);
      if (!existing) return;
      if (existing.observation_count <= 1) {
        await this.repo.delete(pk as any);
        return;
      }
      await this.repo.put({
        ...existing,
        observation_count: existing.observation_count - 1,
      } as TRow);
    });
  }

  /**
   * Write one already-aggregated junction row outright — no read-modify-write,
   * unlike {@link record}'s increment. For a projection that recomputes
   * `observation_count` and the seen-at bounds from the current observations
   * and replaces a resolver version's rows wholesale rather than reconciling
   * them one observation at a time. Serialised per composite PK, like
   * `record`/`remove`, so a rebuild racing live ingestion cannot land between
   * another caller's read and write of the same key.
   */
  protected putRow(row: TRow): Promise<void> {
    const idValue = (row as any)[this.idColumn];
    const assocValue = (row as any)[this.assocColumn];
    return junctionLocks.lock(this.lockKey(idValue, assocValue, row.resolver_version), async () => {
      await this.repo.put(row);
    });
  }

  /** All junction rows for a canonical entity at a resolver version. */
  async listForCanonical(idValue: string, resolver_version: string): Promise<TRow[]> {
    return (await this.repo.query({ [this.idColumn]: idValue, resolver_version } as any)) ?? [];
  }

  /** Purge every junction row for a resolver version; returns the count removed. */
  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const rows = (await this.repo.query({ resolver_version } as any)) ?? [];
    for (const r of rows) {
      await this.repo.delete(
        this.pk((r as any)[this.idColumn], (r as any)[this.assocColumn], r.resolver_version) as any
      );
    }
    return rows.length;
  }
}
