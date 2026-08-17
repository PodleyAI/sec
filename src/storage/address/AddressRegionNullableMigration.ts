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
import { ADDRESS_REPOSITORY_TOKEN, AddressPrimaryKeyNames, AddressSchema } from "./AddressSchema";

const TABLE = "addresses";
/**
 * Deliberately still named for the region even though this now relaxes two
 * columns: the resume probe below looks for exactly this table, so a database
 * stranded mid-rebuild by an older build must keep being found by it. Renaming
 * the sentinel abandons those rows.
 */
const LEGACY_TABLE = "addresses__legacy_region";
/** Every column this rebuild relaxes from NOT NULL to nullable. */
const NULLABLE_COLUMNS = ["state_or_country", "city"] as const;
const COLUMN_LIST = NULLABLE_COLUMNS.join(", ");
/** Single-column PK, so the resume-path merge can anti-join on it. */
const PRIMARY_KEY = AddressPrimaryKeyNames[0];

/**
 * Relaxes every column in {@link NULLABLE_COLUMNS} from NOT NULL to nullable —
 * not only the region the function name records.
 *
 * A US address whose filer left the state blank is kept as
 * `country_code: "US"` with a null region instead of being dropped, and a
 * foreign address whose filer left the city blank is kept with a null city
 * rather than one invented from the country name (see `normalizeAddress`), so
 * both columns have to accept null. `CREATE TABLE IF NOT EXISTS` never alters
 * an existing table, so a database set up before those changes keeps the NOT
 * NULL columns and every such address fails to store.
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
    .prepare<
      [],
      { name: string }
    >(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`)
    .get();
  return Boolean(row);
}

function columnsOf(db: SqliteDb, table: string): { name: string; notnull: number }[] {
  return db.prepare<[], { name: string; notnull: number }>(`PRAGMA table_info(${table})`).all();
}

/**
 * The target columns the table still declares NOT NULL. A column the table
 * does not carry at all is not pending — it is an older shape this migration
 * does not know how to fill.
 */
function stillNotNull(columns: readonly { name: string; notnull: number }[]): string[] {
  return NULLABLE_COLUMNS.filter((target) => {
    const column = columns.find((c) => c.name === target);
    return column !== undefined && column.notnull !== 0;
  });
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
 * Refuses unless `table` carries every column the current schema declares.
 *
 * The copy selects the CURRENT schema's column list out of the table being
 * copied FROM, so a column added to `AddressSchema` after this database was
 * created would make it fail. The rebuild transaction rolls that back cleanly,
 * but the operator would just hit the same failure on every subsequent run with
 * no explanation. Refuse before touching anything instead, and say exactly what
 * is missing — on the resume path too, where the source is the legacy table and
 * a bare "no such column" would be the only clue.
 */
function assertCopyableColumns(db: SqliteDb, table: string): void {
  const existing = new Set(columnsOf(db, table).map((c) => c.name));
  const missing = Object.keys(AddressSchema.properties).filter((c) => !existing.has(c));
  if (missing.length > 0) {
    throw new Error(
      `db setup: cannot rebuild \`${TABLE}\` to relax ${COLUMN_LIST} — \`${table}\` is ` +
        `missing column(s) ${missing.join(", ")} that the current schema declares. ` +
        `Add them (or drop and re-ingest \`${TABLE}\`) before re-running \`sec db setup\`.`
    );
  }
}

/**
 * Copies the legacy table's rows into the rebuilt one and drops the legacy
 * table. Must be called inside the caller's transaction.
 *
 * Only rows the live table does not already hold are copied. On the normal
 * rebuild path the live table was just recreated and is empty, so that is every
 * legacy row and the count check below is exactly as strict as a blind copy.
 * The distinction matters on the resume path, where the live table can already
 * be populated: the older, non-transactional build's LAST step was
 * `DROP TABLE addresses__legacy_region`, so a crash immediately before it —
 * SIGINT, OOM, power loss — left the rows in BOTH tables. That state is not
 * hypothetical: the old code then reported success on every subsequent run (it
 * probed a nullable column and returned early), so a database can have been
 * serving traffic in it for months, accumulating live rows the legacy snapshot
 * has never seen. A blind copy would fail the primary key and roll back,
 * turning a database the old build tolerated into one where `db setup` fails
 * forever; dropping the live table instead would discard everything written
 * since. Merging keeps both.
 *
 * The live row wins a primary-key collision: it is the current state, while the
 * legacy table is a pre-rebuild snapshot. Legacy's own primary key is unique,
 * so no row inserted here can change the verdict for another — the anti-join
 * holds however SQLite chooses to evaluate it.
 *
 * The row-count check is the safety net that makes the transaction meaningful:
 * a copy that silently moved fewer rows (a partially applied statement) throws
 * here, so the whole rebuild rolls back rather than committing a short table.
 */
function copyBackAndDropLegacy(db: SqliteDb): number {
  const cols = schemaColumnList();
  const notAlreadyPresent = `WHERE \`${PRIMARY_KEY}\` NOT IN (SELECT \`${PRIMARY_KEY}\` FROM ${TABLE})`;
  const liveBefore = rowCount(db, TABLE);
  const incoming = Number(
    db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${LEGACY_TABLE} ${notAlreadyPresent}`)
      .get()?.n ?? 0
  );
  const expected = liveBefore + incoming;
  db.exec(
    `INSERT INTO ${TABLE} (${cols}) SELECT ${cols} FROM ${LEGACY_TABLE} ${notAlreadyPresent}`
  );
  const total = rowCount(db, TABLE);
  if (total !== expected) {
    throw new Error(
      `db setup: rebuilding \`${TABLE}\` ended with ${total} rows, expected ${expected} ` +
        `(${liveBefore} already live + ${incoming} from \`${LEGACY_TABLE}\`) — ` +
        `rolling back, no rows were lost.`
    );
  }
  db.exec(`DROP TABLE ${LEGACY_TABLE}`);
  return total;
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
    assertCopyableColumns(db, LEGACY_TABLE);
    db.exec(`BEGIN IMMEDIATE`);
    try {
      // The live table may be absent, or present but still declaring one of
      // the targets NOT NULL. An EMPTY one is dropped so `setupDatabase()`
      // recreates it at the current schema straight away.
      //
      // A POPULATED one is kept and merged into, even though its shape is
      // stale. It used to be refused as "a state no build in this file
      // produces" — true when this relaxed a single column, and no longer:
      // a database that completed the region-only migration carries a live
      // table with a nullable region and a NOT NULL `city`, which is exactly
      // this shape. Dropping it would discard rows and refusing would strand a
      // database that is merely one release behind, so the merge runs and the
      // fall-through below performs the ordinary rebuild that relaxes whatever
      // is still pending.
      const live = tableExists(db, TABLE) ? columnsOf(db, TABLE) : undefined;
      if (live !== undefined && stillNotNull(live).length > 0 && rowCount(db, TABLE) === 0) {
        db.exec(`DROP TABLE ${TABLE}`);
      }
      // A live table that is kept — at the current schema or one release
      // behind — has the legacy rows merged into it by
      // `copyBackAndDropLegacy`.
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
    // Deliberately no `return`: the merged table can still be one release
    // behind on a column (a live table kept above), and the ordinary rebuild
    // below is what relaxes it. It is a no-op when nothing is pending.
  }

  if (!tableExists(db, TABLE)) return;

  // Every target column absent entirely (older shape than this migration
  // knows) or already nullable → nothing to do.
  const pending = stillNotNull(columnsOf(db, TABLE));
  if (pending.length === 0) return;

  assertCopyableColumns(db, TABLE);

  // BEGIN IMMEDIATE, not plain BEGIN: a deferred transaction takes a read lock
  // and then fails the write upgrade with SQLITE_BUSY straight away, which
  // `busy_timeout` does not cover.
  db.exec(`BEGIN IMMEDIATE`);
  try {
    db.exec(`ALTER TABLE ${TABLE} RENAME TO ${LEGACY_TABLE}`);
    dropCarriedOverIndexes(db);
    // Recreate `addresses` at the current schema (nullable targets).
    // setupAllDatabases calls this again right after; the second call is a
    // no-op. Safe inside the transaction — see the note on the resume path.
    await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).setupDatabase();
    const copied = copyBackAndDropLegacy(db);
    db.exec(`COMMIT`);
    console.warn(
      `db setup: rebuilt \`${TABLE}\` with nullable ${pending.join(", ")} (${copied} rows)`
    );
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
    `db setup: rebuilding \`${TABLE}\` to relax ${COLUMN_LIST} failed and was rolled back — ` +
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
    for (const column of NULLABLE_COLUMNS) {
      const info = await client.query(
        `SELECT is_nullable
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = $1 AND column_name = $2`,
        [TABLE, column]
      );
      // Table/column absent (nothing created yet) or already nullable → skip.
      if (info.rowCount === 0 || info.rows[0]?.is_nullable !== "NO") continue;
      await client.query(`ALTER TABLE "${TABLE}" ALTER COLUMN "${column}" DROP NOT NULL`);
    }
  } finally {
    client.release();
  }
}
