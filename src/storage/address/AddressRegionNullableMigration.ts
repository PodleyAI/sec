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
 * The SQLite rebuild runs inside one `BEGIN IMMEDIATE` transaction, and every
 * step of it (`CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ... RENAME`,
 * `DROP TABLE`, the copy) rolls back on failure. That matters because the
 * failure modes are real — the copy transiently doubles the table on disk, and
 * a SIGINT or an OOM lands wherever it lands. Without the transaction an
 * interrupted copy would commit an *empty* `addresses` at the new schema: the
 * next run would see a nullable column, return at the idempotency probe and
 * report success, while every `address_hash_id` referenced from
 * `addresses_entity_junction`, `canonical_person_address` and
 * `canonical_company_address` silently dangled.
 *
 * Idempotent: a fresh DB has no table (no-op), an already-migrated DB has a
 * nullable column (no-op). Recoverable: a database still carrying a stranded
 * `addresses__legacy_region` from an older, non-transactional build resumes the
 * copy rather than dropping it.
 *
 * The Postgres arm overlaps with the generic `alignPostgresColumnTypes()` pass,
 * which reaches the same column from the declared schema; both are catalog
 * probes that no-op once the column is nullable, so running either or both is
 * harmless. The SQLite arm has no generic equivalent — no `ALTER` can relax a
 * column constraint there.
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

type SqliteDb = ReturnType<typeof getDb>;

function tableExists(db: SqliteDb, name: string): boolean {
  const row = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`
    )
    .get();
  return Boolean(row);
}

function columnsOf(db: SqliteDb, table: string): { name: string; notnull: number }[] {
  return db.prepare<[], { name: string; notnull: number }>(`PRAGMA table_info(${table})`).all();
}

function rowCount(db: SqliteDb, table: string): number {
  const row = db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return Number(row?.n ?? 0);
}

/** The current schema's column list, backtick-quoted, in declaration order. */
function schemaColumnList(): string {
  return Object.keys(AddressSchema.properties)
    .map((c) => `\`${c}\``)
    .join(", ");
}

/**
 * SQLite carries a renamed table's indexes along under their original names,
 * which would make the `CREATE INDEX IF NOT EXISTS` in setupDatabase() a silent
 * no-op and leave the rebuilt table unindexed. Drop them first.
 * (`sql IS NULL` marks auto-indexes, which cannot be dropped directly.)
 */
function dropCarriedOverIndexes(db: SqliteDb): void {
  const legacyIndexes = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='${LEGACY_TABLE}' AND sql IS NOT NULL`
    )
    .all();
  for (const { name } of legacyIndexes) {
    db.exec(`DROP INDEX IF EXISTS \`${name}\``);
  }
}

/**
 * Copies every row out of the legacy table into the rebuilt one and drops the
 * legacy table. Must be called inside the caller's transaction.
 *
 * The row-count check is the safety net that makes the transaction meaningful:
 * a copy that silently moved fewer rows (a unique-index violation swallowed by
 * a future `INSERT OR IGNORE`, a partially applied statement) throws here, so
 * the whole rebuild rolls back rather than committing a short table.
 */
function copyBackAndDropLegacy(db: SqliteDb): number {
  const cols = schemaColumnList();
  const expected = rowCount(db, LEGACY_TABLE);
  db.exec(`INSERT INTO ${TABLE} (${cols}) SELECT ${cols} FROM ${LEGACY_TABLE}`);
  const copied = rowCount(db, TABLE);
  if (copied !== expected) {
    throw new Error(
      `db setup: rebuilding \`${TABLE}\` copied ${copied} of ${expected} rows — ` +
        `rolling back, no rows were lost.`
    );
  }
  db.exec(`DROP TABLE ${LEGACY_TABLE}`);
  return copied;
}

async function migrateSqlite(): Promise<void> {
  const db = getDb();

  // `PRAGMA foreign_keys` and `PRAGMA legacy_alter_table` are both no-ops once a
  // transaction is open, so they are set outside it and restored in the finally.
  // `legacy_alter_table` matters beyond compatibility: on SQLite >= 3.25 an
  // `ALTER TABLE ... RENAME TO` rewrites references to the table inside views,
  // so an operator's (or a downstream superset's) view over `addresses` would be
  // silently repointed at the legacy table and then broken when it is dropped.
  const priorForeignKeys = db
    .prepare<[], { foreign_keys: number }>(`PRAGMA foreign_keys`)
    .get()?.foreign_keys;
  const priorLegacyAlter = db
    .prepare<[], { legacy_alter_table: number }>(`PRAGMA legacy_alter_table`)
    .get()?.legacy_alter_table;

  db.exec(`PRAGMA foreign_keys = OFF`);
  db.exec(`PRAGMA legacy_alter_table = ON`);
  try {
    await rebuildSqlite(db);
  } finally {
    db.exec(`PRAGMA foreign_keys = ${priorForeignKeys ? "ON" : "OFF"}`);
    db.exec(`PRAGMA legacy_alter_table = ${priorLegacyAlter ? "ON" : "OFF"}`);
  }
}

async function rebuildSqlite(db: SqliteDb): Promise<void> {
  // Probe for a stranded legacy table FIRST. A database left mid-rebuild by an
  // older, non-transactional build holds every row there, and the two early
  // returns below would both mis-handle it: an empty new-shape `addresses`
  // passes the nullable-column probe, and a missing `addresses` (crash between
  // the rename and the recreate) trips the `!tableExists` return. Either way the
  // rows would be abandoned and `db setup` would report success. Resume instead
  // — and never DROP the legacy table outside the rebuild transaction, since on
  // this path it is the only surviving copy.
  if (tableExists(db, LEGACY_TABLE)) {
    const stranded = rowCount(db, LEGACY_TABLE);
    console.warn(
      `db setup: resuming an interrupted \`${TABLE}\` rebuild from ` +
        `\`${LEGACY_TABLE}\` (${stranded} rows)`
    );
    db.exec(`BEGIN IMMEDIATE`);
    try {
      // The live table may be absent, or present but still legacy-shaped (the
      // rename never happened for it). Either way, replace it with a fresh
      // table at the current schema before copying back.
      const liveRegion = tableExists(db, TABLE)
        ? columnsOf(db, TABLE).find((c) => c.name === COLUMN)
        : undefined;
      if (!tableExists(db, TABLE) || (liveRegion && liveRegion.notnull !== 0)) {
        db.exec(`DROP TABLE IF EXISTS ${TABLE}`);
      }
      dropCarriedOverIndexes(db);
      // Safe to call inside the transaction: `createStorage` passes no
      // `tabularMigrations`, so setupDatabase() is only CREATE TABLE IF NOT
      // EXISTS + createIndexes() — it opens no transaction of its own. Threading
      // `tabularMigrations` through `createStorage` later would make this a
      // nested BEGIN and throw.
      await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).setupDatabase();
      const copied = copyBackAndDropLegacy(db);
      db.exec(`COMMIT`);
      console.warn(`db setup: recovered ${copied} \`${TABLE}\` rows`);
    } catch (err) {
      rollbackQuietly(db);
      throw wrapRebuildError(err);
    }
    return;
  }

  if (!tableExists(db, TABLE)) return;

  const columns = columnsOf(db, TABLE);
  const region = columns.find((c) => c.name === COLUMN);
  // Column absent entirely (older shape than this migration knows) or already
  // nullable → nothing to do.
  if (!region || region.notnull === 0) return;

  // The copy below selects the CURRENT schema's column list out of the renamed
  // table, so a column added to `AddressSchema` after this database was created
  // would make it fail. The rebuild transaction would roll that back cleanly,
  // but the operator would just hit the same failure on every subsequent run
  // with no explanation. Refuse before touching anything instead, and say
  // exactly what is missing.
  const existing = new Set(columns.map((c) => c.name));
  const missing = Object.keys(AddressSchema.properties).filter((c) => !existing.has(c));
  if (missing.length > 0) {
    throw new Error(
      `db setup: cannot rebuild \`${TABLE}\` to relax \`${COLUMN}\` — the existing table is ` +
        `missing column(s) ${missing.join(", ")} that the current schema declares. ` +
        `Add them (or drop and re-ingest \`${TABLE}\`) before re-running \`sec db setup\`.`
    );
  }

  // BEGIN IMMEDIATE, not plain BEGIN: a deferred transaction takes a read lock
  // and then fails the write upgrade with SQLITE_BUSY straight away, which
  // `busy_timeout` does not cover.
  db.exec(`BEGIN IMMEDIATE`);
  try {
    db.exec(`ALTER TABLE ${TABLE} RENAME TO ${LEGACY_TABLE}`);
    dropCarriedOverIndexes(db);
    // Recreate `addresses` at the current schema (nullable region).
    // setupAllDatabases calls this again right after; the second call is a
    // no-op. Safe inside the transaction — see the note on the resume path.
    await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).setupDatabase();
    const copied = copyBackAndDropLegacy(db);
    db.exec(`COMMIT`);
    console.warn(`db setup: rebuilt \`${TABLE}\` with a nullable \`${COLUMN}\` (${copied} rows)`);
  } catch (err) {
    rollbackQuietly(db);
    throw wrapRebuildError(err);
  }
}

/**
 * Rolls back, swallowing a rollback failure. The original error is what the
 * caller needs to see; a "cannot rollback - no transaction is active" on top of
 * it would only hide the cause.
 */
function rollbackQuietly(db: SqliteDb): void {
  try {
    db.exec(`ROLLBACK`);
  } catch {
    // already rolled back, or the transaction never opened
  }
}

function wrapRebuildError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(
    `db setup: rebuilding \`${TABLE}\` to relax \`${COLUMN}\` failed and was rolled back — ` +
      `no rows were lost, \`${TABLE}\` is unchanged. Cause: ${msg}`
  );
  if (err instanceof Error) wrapped.cause = err;
  return wrapped;
}

async function migratePostgres(): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    // Scoped to `current_schema()`: `information_schema` spans every schema the
    // role can see, so a same-named table in another schema would otherwise
    // decide this probe while the ALTER below resolves through the search_path.
    const info = await client.query(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1 AND column_name = $2`,
      [TABLE, COLUMN]
    );
    // Table/column absent (nothing created yet) or already nullable → skip.
    if (info.rowCount === 0 || info.rows[0]?.is_nullable !== "NO") return;
    await client.query(`ALTER TABLE "${TABLE}" ALTER COLUMN "${COLUMN}" DROP NOT NULL`);
  } finally {
    client.release();
  }
}
