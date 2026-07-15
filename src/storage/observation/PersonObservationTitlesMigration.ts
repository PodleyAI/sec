/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";

/**
 * Migrates the legacy `person_observations.title TEXT` column to the current
 * `titles` shape (SQLite TEXT / Postgres JSONB carrying a JSON string array).
 * `SqliteTabularStorage.setupDatabase()` uses `CREATE TABLE IF NOT EXISTS`, so
 * an existing DB never gains the renamed column on its own — the first insert
 * fails with `table has no column named titles`.
 *
 * Idempotent: probes the table's column list before adding; a fresh DB (no
 * table) is a silent no-op. Existing non-null / non-empty `title` values are
 * backfilled as a single-element JSON array; null / empty stay null. The
 * legacy `title` column is left in place — dropping it is unnecessary for the
 * new writer and keeps rollback trivial.
 */
export async function migratePersonObservationTitles(): Promise<void> {
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

function migrateSqlite(): void {
  const db = getDb();
  const tableExistsRow = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='person_observations'`
    )
    .get();
  if (!tableExistsRow) return;
  const columns = db
    .prepare<[], { name: string }>(`PRAGMA table_info(person_observations)`)
    .all();
  const hasTitles = columns.some((c) => c.name === "titles");
  if (hasTitles) return;
  const hasLegacyTitle = columns.some((c) => c.name === "title");
  db.exec("BEGIN");
  try {
    db.exec("ALTER TABLE person_observations ADD COLUMN titles TEXT NULL");
    if (hasLegacyTitle) {
      db.exec(
        `UPDATE person_observations
           SET titles = CASE
             WHEN title IS NULL OR title = '' THEN NULL
             ELSE json_array(title)
           END
         WHERE titles IS NULL`
      );
    }
    db.exec("COMMIT");
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
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'person_observations'`
    );
    const names = cols.rows.map((r: { column_name: string }) => r.column_name);
    const hasTitles = names.includes("titles");
    if (hasTitles) return;
    const hasLegacyTitle = names.includes("title");
    await client.query("BEGIN");
    try {
      await client.query(`ALTER TABLE "person_observations" ADD COLUMN "titles" JSONB NULL`);
      if (hasLegacyTitle) {
        await client.query(
          `UPDATE "person_observations"
             SET "titles" = CASE
               WHEN "title" IS NULL OR "title" = '' THEN NULL
               ELSE jsonb_build_array("title")
             END
           WHERE "titles" IS NULL`
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}
