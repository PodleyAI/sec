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
 * Adds the `loi_date` column to `spac`, `spac_deal`, and `spac_history`. The
 * LOI lifecycle stage landed as a schema addition, but
 * `SqliteTabularStorage.setupDatabase()` uses `CREATE TABLE IF NOT EXISTS`, so
 * an existing DB never gains the new column on its own — the first
 * `SpacReportWriter.rebuild` after upgrade fails on the `loi_date` column.
 *
 * The `spac.status` enum also gained the value `"loi"`, but `TypeStringEnum`
 * generates plain TEXT with **no CHECK constraint** (the enum is validated at
 * the schema layer, not the database), so no DDL change is required for
 * `status`. This migration is limited to the three `loi_date` columns.
 *
 * Idempotent: probes each table's column list before adding; a fresh DB (no
 * tables) is a silent no-op.
 */
export async function migrateSpacLoiColumns(): Promise<void> {
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

const SPAC_LOI_TABLES = ["spac", "spac_deal", "spac_history"] as const;

function migrateSqlite(): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    for (const table of SPAC_LOI_TABLES) {
      const tableExistsRow = db
        .prepare<[], { name: string }>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        )
        .get(table);
      if (!tableExistsRow) continue;
      const columns = db
        .prepare<[], { name: string }>(`PRAGMA table_info(\`${table}\`)`)
        .all();
      if (columns.some((c) => c.name === "loi_date")) continue;
      db.exec(`ALTER TABLE \`${table}\` ADD COLUMN loi_date TEXT NULL`);
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
    await client.query("BEGIN");
    try {
      for (const table of SPAC_LOI_TABLES) {
        const exists = await client.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
          [table]
        );
        if (exists.rowCount === 0) continue;
        const cols = await client.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
          [table]
        );
        const hasLoiDate = cols.rows.some(
          (r: { column_name: string }) => r.column_name === "loi_date"
        );
        if (hasLoiDate) continue;
        await client.query(`ALTER TABLE "${table}" ADD COLUMN "loi_date" DATE NULL`);
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
