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
import { ADDRESS_REPOSITORY_TOKEN, AddressSchema } from "./AddressSchema";

const TABLE = "addresses";
const LEGACY_TABLE = "addresses__legacy_region";
const COLUMN = "state_or_country";

/**
 * Relaxes `addresses.state_or_country` from NOT NULL to nullable.
 *
 * A US address whose filer left the state blank is now kept as
 * `country_code: "US"` with a null region instead of being dropped (see
 * `normalizeAddress`), so the column has to accept null. `CREATE TABLE IF NOT
 * EXISTS` never alters an existing table, so a database set up before that
 * change keeps the NOT NULL column and every such address fails to store.
 *
 * Unlike the legacy 8-K events table, addresses cannot simply be dropped and
 * re-extracted: entity/canonical junction rows reference `address_hash_id`.
 * So the rows are preserved on both backends —
 *
 * - Postgres: `ALTER COLUMN ... DROP NOT NULL`, a catalog-only change.
 * - SQLite: no ALTER can relax a column constraint, so the table is rebuilt —
 *   rename aside, recreate at the current schema, copy every row back, drop the
 *   old one. The column list comes from `AddressSchema`, so it cannot drift.
 *
 * Idempotent: a fresh DB has no table (no-op), an already-migrated DB has a
 * nullable column (no-op).
 */
export async function migrateAddressRegionNullable(): Promise<void> {
  // Raw-SQL DDL reaches around the repository layer, so the dry-run
  // ReadOnlyTabularStorage wrapper cannot intercept it — bail explicitly.
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
  // In-memory backend: no column types, nothing to migrate.
}

async function migrateSqlite(): Promise<void> {
  const db = getDb();

  const tableExists = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${TABLE}'`
    )
    .get();
  if (!tableExists) return;

  const columns = db
    .prepare<[], { name: string; notnull: number }>(`PRAGMA table_info(${TABLE})`)
    .all();
  const region = columns.find((c) => c.name === COLUMN);
  // Column absent entirely (older shape than this migration knows) or already
  // nullable → nothing to do.
  if (!region || region.notnull === 0) return;

  // A previous interrupted run could have left the legacy table behind; the
  // rename below would fail on it.
  db.exec(`DROP TABLE IF EXISTS ${LEGACY_TABLE}`);
  db.exec(`ALTER TABLE ${TABLE} RENAME TO ${LEGACY_TABLE}`);

  // SQLite carries a renamed table's indexes along under their original names,
  // which would make the `CREATE INDEX IF NOT EXISTS` in setupDatabase() a
  // silent no-op and leave the rebuilt table unindexed. Drop them first.
  // (`sql IS NULL` marks auto-indexes, which cannot be dropped directly.)
  const legacyIndexes = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='${LEGACY_TABLE}' AND sql IS NOT NULL`
    )
    .all();
  for (const { name } of legacyIndexes) {
    db.exec(`DROP INDEX IF EXISTS \`${name}\``);
  }

  // Recreate `addresses` at the current schema (nullable region). setupAllDatabases
  // calls this again right after; the second call is a no-op.
  await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).setupDatabase();

  const cols = Object.keys(AddressSchema.properties)
    .map((c) => `\`${c}\``)
    .join(", ");
  db.exec(`INSERT INTO ${TABLE} (${cols}) SELECT ${cols} FROM ${LEGACY_TABLE}`);
  db.exec(`DROP TABLE ${LEGACY_TABLE}`);
}

async function migratePostgres(): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    const info = await client.query(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2`,
      [TABLE, COLUMN]
    );
    // Table/column absent (nothing created yet) or already nullable → skip.
    if (info.rowCount === 0 || info.rows[0]?.is_nullable !== "NO") return;
    await client.query(`ALTER TABLE "${TABLE}" ALTER COLUMN "${COLUMN}" DROP NOT NULL`);
  } finally {
    client.release();
  }
}
