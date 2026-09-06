/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, MIGRATIONS_TABLE } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { SEC_KB_TABLE_NAMES } from "../kb/secKbTables";
import { secFetchRateLimiterTableNames } from "../task/fetch/secFetchRateLimiterConfig";
import { secFetchRateLimiterLedgerComponents } from "../task/fetch/SecJobQueue";
import { getDb } from "../util/db";
import { getPgPool } from "../util/pg";
import { currentSchemaName, quote } from "../util/pgIdentifiers";
import { SEC_STORAGE_REGISTRY } from "./storageRegistry";
import { listRegisteredTables } from "./tableRegistry";
import { SEC_DB_TYPE } from "./tokens";

/** Options for {@link resetAllDatabases}. */
export interface ResetAllDatabasesOptions {
  /** Drop dependent objects (views, etc.) along with the owned tables. */
  readonly cascade?: boolean;
  /**
   * Postgres only: drop and recreate the whole schema instead of the owned
   * objects. Destroys everything in the schema, including objects sec does not
   * own. The historical behavior, kept as an explicit escape hatch.
   */
  readonly dropSchema?: boolean;
}

/**
 * Drops the tables sec owns so `setupAllDatabases()` can recreate them at the
 * current DDL. Used by `sec db reset --confirm`.
 *
 * Dropping rather than truncating is what makes a reset a genuine clean slate:
 * `deleteAll()` only removes rows, so a table whose columns changed since the
 * database was created keeps its old shape — `CREATE TABLE IF NOT EXISTS`
 * never alters an existing table.
 *
 * What it drops is scoped to the {@link listRegisteredTables} ownership list
 * (every table built through `createStorage`) plus the few tables and views
 * created outside it. A reset must not be a
 * whole-database wipe: sec is routinely one schema among several, and
 * destroying an unrelated table or a colleague's reporting view is not
 * something a "reset sec's tables" command may do. Tables that are present but
 * unowned are reported rather than dropped, which still surfaces the orphan of
 * a removed repo without the blast radius. The shared migration ledger is
 * scoped the same way — see {@link clearOwnedLedgerRows}.
 *
 * `dropSchema` restores the historical whole-schema drop for anyone who wants
 * it; `cascade` drops dependent objects along with the owned tables.
 */
export async function resetAllDatabases(options: ResetAllDatabasesOptions = {}): Promise<void> {
  // Raw DDL reaches around the repository layer, so the dry-run
  // ReadOnlyTabularStorage wrapper cannot intercept it — bail explicitly.
  if (isDryRun()) return;

  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  if (dbType === "postgres") {
    await resetPostgres(options);
    return;
  }

  if (dbType === "sqlite") {
    resetSqlite(options);
    return;
  }

  // In-memory / other backends have no schema to drop, so fall back to
  // truncating each registered repository.
  await truncateAllRepositories();
}

/**
 * Every table name this reset owns: the registry plus the few created outside it.
 *
 * The knowledge base's tables are among those few — they are built lazily,
 * against `getDb()` directly, so `createStorage` never sees them. Leaving them
 * out made a reset destructive in the worst direction: `kb_document` survived,
 * every filing then anti-joined as "already indexed", and `ask` answered from
 * vectors of documents the database no longer held.
 *
 * The rate-limiter tables are derived from the configuration
 * `setupSecFetchRateLimiter()` builds its storage with, not named literally:
 * `PostgresRateLimiterStorage` renames them when it is given prefix columns,
 * and a reset that kept dropping the unprefixed names would silently leave the
 * real ones — and their execution rows — behind, so a recreated database would
 * inherit a rate-limit budget from before the reset.
 */
export function ownedTableNames(): ReadonlyArray<string> {
  return [
    ...listRegisteredTables().map((t) => t.table),
    ...SEC_KB_TABLE_NAMES,
    ...secFetchRateLimiterTableNames(),
  ];
}

async function resetPostgres(options: ResetAllDatabasesOptions): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    // Every drop below is schema-qualified. An unqualified `DROP TABLE` resolves
    // through the search_path, so a name sec owns but that is absent from the
    // current schema would be found — and destroyed — in the NEXT schema on the
    // path. That is exactly the unowned-object destruction this reset exists to
    // avoid, and it is the common shape: sec in its own schema with `public`
    // still on the path.
    const schema = await currentSchemaName(client, "db reset");
    const qualify = (object: string): string => `"${quote(schema)}"."${quote(object)}"`;

    if (options.dropSchema) {
      // CASCADE clears tables, views, sequences and indexes in one statement.
      // Destroys unowned objects too — opt-in only. Resolved from
      // `current_schema()` rather than hardcoded to `public`: sec's tables live
      // wherever the connection's search_path points (SEC_PG_URL can carry
      // `options=-csearch_path=…`), and dropping `public` there would destroy
      // an unrelated schema while leaving every sec table standing.
      await client.query(`DROP SCHEMA "${quote(schema)}" CASCADE`);
      await client.query(`CREATE SCHEMA "${quote(schema)}"`);
      return;
    }

    const owned = ownedTableNames();
    const present = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
      []
    );
    const presentNames = present.rows.map((r: { table_name: string }) => r.table_name);
    reportUnownedTables(presentNames, owned);

    // One transaction for the whole set. Postgres has transactional DDL, so a
    // drop blocked partway through — a reporting view on `filings`, say — rolls
    // the earlier drops back instead of leaving the caller with half a database
    // and no recreate: `DbResetTask` never reaches `setupAllDatabases()` once
    // this throws. "Reset" has to mean all-or-nothing, or the failure mode is
    // worse than not running it.
    await client.query("BEGIN");
    try {
      for (const table of owned) {
        const sql = `DROP TABLE IF EXISTS ${qualify(table)}${options.cascade ? " CASCADE" : ""}`;
        try {
          await client.query(sql);
        } catch (err) {
          throw dependentObjectError(err, table, sql);
        }
      }
      await clearOwnedLedgerRows(client, qualify, presentNames);
      await client.query("COMMIT");
    } catch (err) {
      // Best-effort: the transaction is already aborted, so this only clears the
      // connection's state. Swallow its own failure so the original error is
      // what surfaces.
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
  } finally {
    client.release();
  }
}

/**
 * Removes the applied-version rows sec's own setup wrote for the tables this
 * reset just dropped — and only those.
 *
 * `_storage_migrations` is `@workglow/storage`'s ledger, and every package built
 * on it records there under one fixed table name: a row per applied
 * `(component, version)`. Dropping the table would take a co-tenant's rows with
 * it, and their next setup would then replay `addColumn` ops against tables that
 * already carry those columns — exactly the destroy-what-you-do-not-own this
 * reset exists to avoid. So the rows go by component and the table stays
 * standing; `--drop-schema` still takes it along with everything else.
 *
 * Clearing sec's own rows is not optional, though: a runner skips a
 * `(component, version)` it finds recorded, so a row outliving the table its
 * migration created would stop `db setup` from ever recreating it. Today that is
 * only the Postgres rate limiter — no sec table declares migrations, and
 * `createStorage` does not even accept them.
 */
async function clearOwnedLedgerRows(
  client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  qualify: (object: string) => string,
  presentNames: ReadonlyArray<string>
): Promise<void> {
  const components = secFetchRateLimiterLedgerComponents();
  // Nothing of ours recorded, or no ledger in this schema at all (nothing on
  // this database ever declared a migration) — `DELETE FROM` a table that does
  // not exist would abort the transaction the drops just ran in.
  if (components.length === 0 || !presentNames.includes(MIGRATIONS_TABLE)) return;
  await client.query(`DELETE FROM ${qualify(MIGRATIONS_TABLE)} WHERE component = ANY($1)`, [
    components,
  ]);
}

function resetSqlite(options: ResetAllDatabasesOptions): void {
  // SQLite has neither a droppable schema nor `DROP TABLE ... CASCADE`, and the
  // scoped path below is already what either flag would degrade to. Say so
  // rather than accepting the flag and silently doing something else.
  if (options.cascade || options.dropSchema) {
    console.warn(
      "db reset: --cascade / --drop-schema are Postgres-only; the SQLite reset drops the " +
        "tables sec owns either way."
    );
  }
  const db = getDb();
  const present = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  const owned = ownedTableNames();
  reportUnownedTables(
    present.map((t) => t.name),
    owned
  );

  // FKs off for the duration: dropping in list order would otherwise fail on a
  // table still referenced by one not yet dropped.
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    // SQLite has a single schema per attached database, so an unqualified name
    // cannot resolve outside it the way Postgres's search_path allows.
    for (const table of owned) {
      db.exec(`DROP TABLE IF EXISTS "${quote(table)}"`);
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Names tables that exist but are not sec's, so an operator can see what a
 * scoped reset deliberately left in place — including the orphan table of a
 * repository that was removed, which no per-repo list could ever reach.
 *
 * The list is NOT a drop list. `_storage_migrations` is always on it — the
 * shared ledger is deliberately left standing (see {@link clearOwnedLedgerRows})
 * and dropping it would destroy every co-tenant's applied-version rows — so the
 * message asks for review rather than telling the operator to drop what it names.
 */
function reportUnownedTables(present: ReadonlyArray<string>, owned: ReadonlyArray<string>): void {
  const ownedSet = new Set(owned);
  const unowned = present.filter((name) => !ownedSet.has(name)).sort();
  if (unowned.length > 0) {
    console.warn(
      `db reset: left ${unowned.length} table(s) in place that sec does not own: ` +
        `${unowned.join(", ")}. Review before dropping any by hand — ${MIGRATIONS_TABLE} is ` +
        `shared infrastructure that must survive, not an orphan of a removed repository.`
    );
  }
}

/**
 * Turns Postgres's terse `2BP01` (dependent objects still exist) into an error
 * that says which table blocked, what Postgres said depends on it, and how to
 * proceed.
 */
function dependentObjectError(err: unknown, table: string, sql: string): unknown {
  const code = (err as { code?: string } | null)?.code;
  if (code !== "2BP01") return err;
  const detail = (err as { detail?: string }).detail ?? "(no detail reported)";
  return new Error(
    `db reset: could not drop "${table}" — other objects depend on it. ${detail} ` +
      `Re-run with --cascade to drop those dependents too, or --drop-schema to drop and ` +
      `recreate the entire schema (which also destroys objects sec does not own). ` +
      `Failing statement: ${sql}`,
    { cause: err }
  );
}

/**
 * In-memory / other backends have no schema to drop, so every registered
 * repository is truncated instead.
 */
async function truncateAllRepositories(): Promise<void> {
  for (const definition of SEC_STORAGE_REGISTRY) {
    await globalServiceRegistry.get(definition.token).deleteAll();
  }
}
