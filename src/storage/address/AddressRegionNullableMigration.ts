/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_DB_TYPE } from "../../config/tokens";
import { getPgPool } from "../../util/pg";

const TABLE = "addresses";
const COLUMN = "state_or_country";

/**
 * Relaxes `addresses.state_or_country` from NOT NULL to nullable on an
 * existing Postgres deployment.
 *
 * A US address whose filer left the state blank is now kept as
 * `country_code: "US"` with a null region instead of being dropped (see
 * `normalizeAddress`), so the column has to accept null. `CREATE TABLE IF NOT
 * EXISTS` never alters an existing table, so a database set up before that
 * change keeps the NOT NULL column and every such address fails to store.
 *
 * Postgres-only: SQLite's TEXT columns have no persistent NOT NULL that
 * survives a schema-level widen, and the current `AddressSchema` is the
 * authoritative source for the SQLite table (a fresh DB comes up nullable
 * automatically); the in-memory backend has no column types at all. Both are
 * no-ops.
 *
 * `ALTER COLUMN ... DROP NOT NULL` is a catalog-only change and cheap;
 * idempotent — a fresh DB has no table (no-op), an already-migrated DB has a
 * nullable column (no-op).
 */
export async function migrateAddressRegionNullable(): Promise<void> {
  // Raw-SQL DDL reaches around the repository layer, so the dry-run
  // ReadOnlyTabularStorage wrapper cannot intercept it — bail explicitly.
  if (isDryRun()) return;

  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;
  if (dbType !== "postgres") return;

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
