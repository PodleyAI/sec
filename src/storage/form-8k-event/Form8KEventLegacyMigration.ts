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
 * Drops a `form_8k_events` table that pre-dates the versioned-PK shape
 * introduced alongside this module. The legacy table used the natural key
 * `(cik, accession_number, item_code)` as the primary key and lacked the
 * `event_id` / `extractor_id` / `extractor_version` columns; the new shape
 * cannot be reached by ALTER TABLE on either backend (SQLite cannot drop
 * an existing PK; Postgres needs a separate UNIQUE constraint).
 *
 * 8-K events are deterministic to re-extract — every row is a function of
 * the filing's items list and the form metadata — so dropping the legacy
 * table is the operationally cheapest path forward. A new table is created
 * by `setupDatabase()` immediately afterwards.
 *
 * The probe is structural rather than version-tagged: if the existing table
 * is missing the `event_id` column it is treated as legacy. This keeps the
 * cleanup idempotent (a new DB has no table at all → no-op; a freshly
 * migrated DB has the new column → no-op).
 */
export async function migrateLegacyForm8KEventsTable(): Promise<void> {
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
      `SELECT name FROM sqlite_master WHERE type='table' AND name='form_8k_events'`
    )
    .get();
  if (!tableExistsRow) return;
  const columns = db
    .prepare<[], { name: string }>(`PRAGMA table_info(form_8k_events)`)
    .all();
  const hasEventId = columns.some((c) => c.name === "event_id");
  if (hasEventId) return;
  db.exec("DROP TABLE form_8k_events");
}

async function migratePostgres(): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'form_8k_events'`
    );
    if (exists.rowCount === 0) return;
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'form_8k_events'`
    );
    const hasEventId = cols.rows.some((r: { column_name: string }) => r.column_name === "event_id");
    if (hasEventId) return;
    await client.query(`DROP TABLE "form_8k_events"`);
  } finally {
    client.release();
  }
}
