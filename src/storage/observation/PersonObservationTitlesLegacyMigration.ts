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

  db.exec("BEGIN");
  try {
    let cursor = 0;
    let migrated = 0;
    let sinceLastLog = 0;
    for (;;) {
      const rows = select.all(cursor, CHUNK_SIZE);
      if (rows.length === 0) break;
      for (const row of rows) {
        cursor = row.observation_id;
        const titles = normalizeTitles(row.titles);
        for (const title of titles) {
          insert.run(row.observation_id, title);
          migrated += 1;
          sinceLastLog += 1;
          if (sinceLastLog >= PROGRESS_INTERVAL) {
            console.log(
              `[migrate person_observation_titles] wrote ${migrated} title rows so far`
            );
            sinceLastLog = 0;
          }
        }
      }
      if (rows.length < CHUNK_SIZE) break;
    }
    db.exec("COMMIT");
    if (migrated > 0) {
      console.log(`[migrate person_observation_titles] wrote ${migrated} title rows total`);
    }
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
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

    await client.query("BEGIN");
    try {
      let cursor = 0;
      let migrated = 0;
      let sinceLastLog = 0;
      for (;;) {
        // Bring rows back as text either way so the JS normalizer sees a
        // uniform shape; jsonb is serialized deterministically by pg.
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
        for (const row of res.rows) {
          cursor = row.observation_id;
          // `titles::text` serializes a jsonb array to the same JSON literal a
          // text-typed column carries, so `normalizeTitles` handles both.
          const titles = normalizeTitles(row.titles);
          for (const title of titles) {
            await client.query(
              `INSERT INTO person_observation_titles (observation_id, title)
               VALUES ($1, $2)
               ON CONFLICT DO NOTHING`,
              [row.observation_id, title]
            );
            migrated += 1;
            sinceLastLog += 1;
            if (sinceLastLog >= PROGRESS_INTERVAL) {
              console.log(
                `[migrate person_observation_titles] wrote ${migrated} title rows so far`
              );
              sinceLastLog = 0;
            }
          }
        }
        if (res.rows.length < CHUNK_SIZE) break;
      }
      await client.query("COMMIT");
      if (migrated > 0) {
        console.log(`[migrate person_observation_titles] wrote ${migrated} title rows total`);
      }
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}
