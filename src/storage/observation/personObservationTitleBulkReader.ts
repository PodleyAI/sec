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

/**
 * SQLite binds one parameter per id and caps a statement at
 * SQLITE_MAX_VARIABLE_NUMBER (999 on older builds), so a long id list is read
 * in chunks. Postgres passes the whole list as a single array parameter and
 * needs no chunking.
 */
const SQLITE_MAX_IDS_PER_STATEMENT = 900;

const TABLE = "person_observation_titles";

/**
 * Every title row for `observation_ids`, in ONE round trip per backend
 * (chunked only where SQLite's bind-parameter cap forces it).
 *
 * `ITabularStorage.query` matches a single column value, so the abstraction
 * can only express this as one query per id — an N+1 that a caller joining
 * titles onto a page of person observations pays in full. The `observation_id`
 * index makes the `IN`-list a single index range scan instead.
 *
 * Ids with no titles simply have no rows here; grouping is the caller's job
 * (see {@link PersonObservationTitleRepo.listForObservations}).
 */
export async function readTitlesForObservations(
  repo: PersonObservationTitleRepositoryStorage,
  observation_ids: readonly number[]
): Promise<PersonObservationTitle[]> {
  if (observation_ids.length === 0) return [];
  const backend = resolveSqlBackend(repo);

  if (backend === "sqlite") {
    const db = getDb();
    const rows: PersonObservationTitle[] = [];
    for (let start = 0; start < observation_ids.length; start += SQLITE_MAX_IDS_PER_STATEMENT) {
      const slice = observation_ids.slice(start, start + SQLITE_MAX_IDS_PER_STATEMENT);
      const stmt = db.prepare<number[], PersonObservationTitle>(
        `SELECT "observation_id", "title" FROM "${TABLE}" ` +
          `WHERE "observation_id" IN (${slice.map(() => "?").join(", ")})`
      );
      rows.push(...stmt.all(...slice));
    }
    return rows;
  }

  if (backend === "postgres") {
    const pool = getPgPool();
    const res = await pool.query<PersonObservationTitle>(
      `SELECT "observation_id", "title" FROM "${TABLE}" WHERE "observation_id" = ANY($1::int[])`,
      [[...observation_ids]]
    );
    return res.rows;
  }

  // Repository fallback (tests / in-memory backend): the per-id fan-out this
  // helper exists to avoid on a real database. Only reached on small datasets.
  const perId = await Promise.all(
    observation_ids.map(async (observation_id) => (await repo.query({ observation_id })) ?? [])
  );
  return perId.flat();
}
