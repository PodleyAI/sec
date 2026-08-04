/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import { resolveSqlBackend } from "../../util/sqlBackend";
import type {
  PersonObservationTitle,
  PersonObservationTitleRepositoryStorage,
} from "./PersonObservationTitleSchema";
import { PersonObservationTitleTable } from "./PersonObservationTitleSchema";

/**
 * SQLite binds one parameter per id and caps a statement at
 * SQLITE_MAX_VARIABLE_NUMBER — 32766 on current builds but 999 on ones
 * predating SQLite 3.32 — so a long id list is read in chunks. Postgres passes
 * the whole list as a single array parameter and needs no chunking.
 *
 * Exported so the test can derive the expected chunking from the constant
 * rather than restating it (and thus keep failing if the chunking is removed).
 */
export const SQLITE_MAX_IDS_PER_STATEMENT = 900;

/**
 * Every title row for `observation_ids`, in a single statement per backend —
 * except SQLite, which takes one statement per {@link
 * SQLITE_MAX_IDS_PER_STATEMENT}-sized chunk.
 *
 * `ITabularStorage.query` matches a single column value, so the abstraction
 * can only express this as one query per id — an N+1 that a caller joining
 * titles onto a page of person observations pays in full. The `observation_id`
 * index makes the `IN`-list a single index range scan instead.
 *
 * Ids are de-duplicated, so each row is returned once no matter how often its
 * id appears. Ids with no titles simply have no rows; grouping is the caller's
 * job (see `PersonObservationTitleRepo.listForObservations`).
 */
export async function readTitlesForObservations(
  repo: PersonObservationTitleRepositoryStorage,
  observation_ids: readonly number[]
): Promise<PersonObservationTitle[]> {
  // De-duplicate here, not just in the caller: the SQL paths return each row
  // once for a repeated id, and the repository fan-out below would otherwise
  // return it once per repeat — a backend-dependent result for the same input.
  const ids = [...new Set(observation_ids)];
  if (ids.length === 0) return [];
  const backend = resolveSqlBackend(repo);

  if (backend === "sqlite") {
    const db = getDb();
    const selectForIdCount = (
      count: number
    ): ReturnType<typeof db.prepare<number[], PersonObservationTitle>> =>
      db.prepare<number[], PersonObservationTitle>(
        `SELECT "observation_id", "title" FROM "${PersonObservationTitleTable}" ` +
          `WHERE "observation_id" IN (${Array(count).fill("?").join(", ")})`
      );

    // Every chunk but the last has the same width, so one statement serves them
    // all; only a short final chunk needs its own.
    let fullChunk: ReturnType<typeof selectForIdCount> | undefined;
    const rows: PersonObservationTitle[] = [];
    for (let start = 0; start < ids.length; start += SQLITE_MAX_IDS_PER_STATEMENT) {
      const slice = ids.slice(start, start + SQLITE_MAX_IDS_PER_STATEMENT);
      const stmt =
        slice.length === SQLITE_MAX_IDS_PER_STATEMENT
          ? (fullChunk ??= selectForIdCount(SQLITE_MAX_IDS_PER_STATEMENT))
          : selectForIdCount(slice.length);
      rows.push(...stmt.all(...slice));
    }
    return rows;
  }

  if (backend === "postgres") {
    const pool = getPgPool();
    const res = await pool.query<PersonObservationTitle>(
      `SELECT "observation_id", "title" FROM "${PersonObservationTitleTable}" ` +
        `WHERE "observation_id" = ANY($1::int[])`,
      [ids]
    );
    return res.rows;
  }

  // Repository fallback (tests / in-memory backend): the per-id fan-out this
  // helper exists to avoid on a real database. Only reached on small datasets.
  const perId = await Promise.all(
    ids.map(async (observation_id) => (await repo.query({ observation_id })) ?? [])
  );
  return perId.flat();
}
