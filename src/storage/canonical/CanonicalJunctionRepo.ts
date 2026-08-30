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
   * Write one already-aggregated junction row outright — no read-modify-write,
   * unlike {@link record}'s increment. For a projection that recomputes
   * `observation_count` and the seen-at bounds from the current observations
   * and replaces a resolver version's rows wholesale rather than reconciling
   * them one observation at a time.
   *
   * Serialised per composite PK, like `record`/`remove`, so this one write
   * cannot land inside another caller's read-modify-write of the same key.
   * That is the whole of the guarantee: the lock spans a single row, not a
   * caller's purge-then-write sequence, so an observation recorded after a
   * projection read its input but before {@link deleteForResolverVersion}
   * runs has its contribution deleted and never written back — self-healing
   * on the next rebuild, wrong in between. A projection rebuild therefore
   * expects ingestion to be quiesced.
   */
  protected putRow(row: TRow): Promise<void> {
    const idValue = (row as any)[this.idColumn];
    const assocValue = (row as any)[this.assocColumn];
    return junctionLocks.lock(this.lockKey(idValue, assocValue, row.resolver_version), async () => {
      await this.repo.put(row);
    });
  }

  /**
   * The projection's public replace path — one row, already aggregated, in
   * place of whatever the resolver version held for that composite PK. See
   * {@link putRow} for what the serialisation does and does not cover. `TRow`
   * is the subclass's own row type, so each
   * `Canonical{Person,Company}{Address,Phone}Repo` exposes this concretely
   * typed without restating it.
   */
  replaceAggregate(row: TRow): Promise<void> {
    return this.putRow(row);
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
