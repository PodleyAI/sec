/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";

/**
 * Copies the pre-existing `person_observations.titles` JSON-array column onto
 * the per-title child table `person_observation_titles`. The child table is
 * the sole read path in the new schema, so an in-place upgrade of a DB set up
 * before that split would silently lose every title on query surfaces without
 * this backfill.
 *
 * The legacy column is left in place — SQLite cannot drop it without a full
 * table rebuild and no read path consults it any more — and the migration is
 * safe to re-run: `INSERT OR IGNORE` / `ON CONFLICT DO NOTHING` on the child
 * table's `(observation_id, title)` PK skips rows already present, so replays
 * (or partial prior runs) do not disturb existing rows.
 *
 * The backfill is **chunked into per-commit batches** so an interrupt only
 * loses the in-flight chunk. Prior successful chunks stay committed; a re-run
 * resumes by re-scanning from `observation_id > 0` and the PK guard silently
 * skips already-written rows. The Postgres branch additionally holds row locks
 * only for the duration of a single chunk, not the whole run.
 */
export async function migrateLegacyPersonObservationTitles(): Promise<void> {
  // This backfill writes rows through raw SQL, reaching around the repository
  // layer, so the dry-run ReadOnlyTabularStorage wrapper cannot intercept it.
  // Bail explicitly: on a dry run we must not mutate the database.
  if (isDryRun()) return;

  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  if (
    dbType === "sqlite" &&
    globalServiceRegistry.has(SEC_DB_FOLDER) &&
    globalServiceRegistry.has(SEC_DB_NAME)
  ) {
    return migrateSqlite();
  }
  if (dbType === "postgres") {
    return migratePostgres();
  }
  // In-memory backend: nothing to migrate (tests start with a clean store).
}

// per-commit batch size — an interrupt loses at most one chunk
const CHUNK_SIZE = 5000;
const TITLE_MAX_LENGTH = 256;
const PROGRESS_INTERVAL = 100_000;

interface LegacyTitleRow {
  readonly observation_id: number;
  readonly titles: string | null;
}

/**
 * Parse a stored `titles` value into a de-duplicated, clamped list of
 * non-empty title strings. Malformed JSON, non-arrays, and non-string elements
 * are ignored — they cannot represent a title claim.
 */
function normalizeTitles(raw: string | null): string[] {
  if (raw === null || raw === "" || raw === "null" || raw === "[]") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of parsed) {
    if (typeof el !== "string") continue;
    const title = el.trim().slice(0, TITLE_MAX_LENGTH);
    if (title === "") continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(title);
  }
  return out;
}

function migrateSqlite(): void {
  const db = getDb();
  const tableExistsRow = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='person_observations'`
    )
    .get();
  if (!tableExistsRow) return;
  const columns = db.prepare<[], { name: string }>(`PRAGMA table_info(person_observations)`).all();
  const hasTitles = columns.some((c) => c.name === "titles");
  if (!hasTitles) return;

  const select = db.prepare<
    [number, number],
    LegacyTitleRow
  >(
    `SELECT observation_id, titles
       FROM person_observations
      WHERE titles IS NOT NULL
        AND titles != '[]'
        AND titles != 'null'
        AND observation_id > ?
      ORDER BY observation_id
      LIMIT ?`
  );
  const insert = db.prepare<[number, string], unknown>(
    `INSERT OR IGNORE INTO person_observation_titles (observation_id, title) VALUES (?, ?)`
  );

  // better-sqlite3's transaction() wraps its callback in BEGIN/COMMIT with an
  // automatic ROLLBACK on throw — so we get per-chunk atomicity without the
  // outer-run transaction that previously kept a mid-run interrupt from
  // preserving any successful chunk.
  const insertChunk = db.transaction((pairs: readonly (readonly [number, string])[]) => {
    for (const [id, title] of pairs) {
      insert.run(id, title);
    }
  });

  let cursor = 0;
  let lastCommittedObservationId = 0;
  let migrated = 0;
  let sinceLastLog = 0;
  for (;;) {
    const rows = select.all(cursor, CHUNK_SIZE);
    if (rows.length === 0) break;

    const pairs: [number, string][] = [];
    for (const row of rows) {
      cursor = row.observation_id;
      const titles = normalizeTitles(row.titles);
      for (const title of titles) {
        pairs.push([row.observation_id, title]);
      }
    }

    if (pairs.length > 0) {
      try {
        insertChunk(pairs);
      } catch (err) {
        console.warn(
          `[migrate person_observation_titles] chunk rolled back after observation_id ` +
            `${lastCommittedObservationId}; re-run resumes from there`
        );
        throw err;
      }
      migrated += pairs.length;
      sinceLastLog += pairs.length;
      if (sinceLastLog >= PROGRESS_INTERVAL) {
        console.log(
          `[migrate person_observation_titles] wrote ${migrated} title rows so far`
        );
        sinceLastLog = 0;
      }
    }
    lastCommittedObservationId = cursor;

    if (rows.length < CHUNK_SIZE) break;
  }
  if (migrated > 0) {
    console.log(`[migrate person_observation_titles] wrote ${migrated} title rows total`);
  }
}

async function migratePostgres(): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'person_observations'`
    );
    if (exists.rowCount === 0) return;
    const cols = await client.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'person_observations' AND column_name = 'titles'`
    );
    if (cols.rowCount === 0) return;

    let cursor = 0;
    let lastCommittedObservationId = 0;
    let migrated = 0;
    let sinceLastLog = 0;
    for (;;) {
      // Plain SELECT — no transaction needed, and holding one across every
      // chunk was the source of the multi-hour row-lock hold.
      const res = await client.query<{ observation_id: number; titles: string | null }>(
        `SELECT observation_id, titles::text AS titles
           FROM person_observations
          WHERE titles IS NOT NULL
            AND titles::text NOT IN ('[]', 'null')
            AND observation_id > $1
          ORDER BY observation_id
          LIMIT $2`,
        [cursor, CHUNK_SIZE]
      );
      if (res.rows.length === 0) break;

      const obsIds: number[] = [];
      const titles: string[] = [];
      for (const row of res.rows) {
        cursor = row.observation_id;
        // `titles::text` serializes a jsonb array to the same JSON literal a
        // text-typed column carries, so `normalizeTitles` handles both.
        const parsed = normalizeTitles(row.titles);
        for (const title of parsed) {
          obsIds.push(row.observation_id);
          titles.push(title);
        }
      }

      if (titles.length > 0) {
        await client.query("BEGIN");
        try {
          // Single per-chunk bulk insert: node-postgres serializes number[] as
          // int[] and string[] as text[] natively, and UNNEST zips the two flat
          // arrays into rows so the whole chunk is one round-trip instead of
          // one RTT per title.
          await client.query(
            `INSERT INTO person_observation_titles (observation_id, title)
             SELECT * FROM UNNEST($1::int[], $2::text[])
             ON CONFLICT DO NOTHING`,
            [obsIds, titles]
          );
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          console.warn(
            `[migrate person_observation_titles] chunk rolled back after observation_id ` +
              `${lastCommittedObservationId}; re-run resumes from there`
          );
          throw err;
        }
        // Count attempted pairs, not res.rowCount — a re-run over already-
        // migrated rows returns rowCount 0 despite doing the right thing.
        migrated += titles.length;
        sinceLastLog += titles.length;
        if (sinceLastLog >= PROGRESS_INTERVAL) {
          console.log(
            `[migrate person_observation_titles] wrote ${migrated} title rows so far`
          );
          sinceLastLog = 0;
        }
      }
      lastCommittedObservationId = cursor;

      if (res.rows.length < CHUNK_SIZE) break;
    }
    if (migrated > 0) {
      console.log(`[migrate person_observation_titles] wrote ${migrated} title rows total`);
    }
  } finally {
    client.release();
  }
}
