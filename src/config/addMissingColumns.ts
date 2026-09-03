/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, Sqlite } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { getPgPool } from "../util/pg";
import { currentSchemaName, quote } from "../util/pgIdentifiers";
import {
  declaredNullable,
  declaredStringType,
  nonNullType,
  type ObjectSchema,
  type PropertySchema,
} from "./alignPostgresColumnTypes";
import { listRegisteredTables, type RegisteredTable } from "./tableRegistry";
import { SEC_DB_TYPE } from "./tokens";

/**
 * One `ADD COLUMN` a live database needs to catch up with the declared schema,
 * or — when `sqlite` and `postgres` are both null — one the mirror declines to
 * emit, with {@link MissingColumn.unsupported} saying why.
 */
export interface MissingColumn {
  readonly table: string;
  readonly column: string;
  /** Column type for SQLite's `ALTER TABLE ... ADD COLUMN`, or null when skipped. */
  readonly sqlite: string | null;
  /** Column type for Postgres's `ALTER TABLE ... ADD COLUMN`, or null when skipped. */
  readonly postgres: string | null;
  /** Why the DDL is null. Null when the column IS plannable. */
  readonly unsupported: string | null;
}

/**
 * The declared type as SQLite's DDL emitter would write it, or null for a
 * declared type this mirror does not model.
 *
 * Mirrors `SqliteTabularStorage.mapTypeToSQL`. The emitter annotates a couple of
 * its types with a trailing comment (`TEXT /* VARCHAR(512) *\/`, `TEXT /* JSON
 * *\/`); SQLite strips comments while tokenizing, so the stored declared type is
 * the bare keyword and the plain form here is the same column.
 */
export function sqliteColumnType(typeDef: PropertySchema): string | null {
  const actual = nonNullType(typeDef);
  if (actual.contentEncoding === "blob") return "BLOB";
  if (isTypedArray(actual)) return null;
  switch (actual.type) {
    case "string":
      return "TEXT";
    case "integer":
      return "INTEGER";
    case "number":
      // The emitter reads `multipleOf: 1` as "integral" even on a `number`.
      return actual.multipleOf === 1 ? "INTEGER" : "REAL";
    case "boolean":
      return "INTEGER";
    default:
      return null;
  }
}

/**
 * The declared type as the Postgres DDL emitter would write it, or null for a
 * declared type this mirror does not model.
 *
 * Mirrors `mapPostgresType`. Note two places a plausible-looking guess would be
 * wrong, which is exactly why this is checked against the real emitter rather
 * than written from the JSON-Schema spec: a bare `number` is `NUMERIC`, not
 * `DOUBLE PRECISION` (that spelling needs `format: "double"`), and an integer's
 * width depends on `minimum`/`maximum` rather than being uniformly `BIGINT`.
 */
export function postgresColumnType(typeDef: PropertySchema): string | null {
  const actual = nonNullType(typeDef);
  if (actual.contentEncoding === "blob") return "BYTEA";
  if (isTypedArray(actual)) return null;
  switch (actual.type) {
    case "string": {
      switch (actual.format) {
        case "date-time":
          return "TIMESTAMP";
        case "date":
          return "DATE";
        case "uuid":
          return "UUID";
        default:
          break;
      }
      const declared = declaredStringType(actual);
      // `declaredStringType` already resolves email/uri to their fixed widths
      // and an absent `maxLength` to unbounded TEXT, and it is the same helper
      // `alignPostgresColumnTypes` widens against — so a column added here and
      // a column widened there cannot disagree about what the schema declares.
      if (declared.kind === "varchar") return `VARCHAR(${declared.width})`;
      if (declared.kind === "text") return "TEXT";
      return null;
    }
    case "integer":
    case "number":
      return postgresNumericType(actual);
    case "boolean":
      return "BOOLEAN";
    default:
      return null;
  }
}

/** The integer/decimal half of {@link postgresColumnType}. */
function postgresNumericType(actual: PropertySchema): string | null {
  const integral = actual.type === "integer" || actual.multipleOf === 1;
  if (integral) {
    const { minimum, maximum } = actual;
    if (typeof minimum === "number" && minimum >= 0) {
      if (typeof maximum === "number") {
        if (maximum <= 32767) return "SMALLINT";
        if (maximum <= 2147483647) return "INTEGER";
      }
      // Non-negative and unbounded above: the emitter assumes it may exceed an
      // INTEGER rather than truncating a CIK-sized value.
      return "BIGINT";
    }
    if (typeof maximum === "number" && maximum > 2147483647) return "BIGINT";
    if (typeof minimum === "number" && minimum < -2147483648) return "BIGINT";
    return "INTEGER";
  }
  if (actual.format === "float") return "REAL";
  if (actual.format === "double") return "DOUBLE PRECISION";
  if (typeof actual.multipleOf === "number") {
    const decimals = String(actual.multipleOf).split(".")[1]?.length ?? 0;
    if (decimals > 0) return `NUMERIC(38, ${decimals})`;
  }
  return "NUMERIC";
}

/** Typed-array (vector) formats, which map to a pgvector column, not a scalar. */
function isTypedArray(actual: PropertySchema): boolean {
  return actual.format === "TypedArray" || (actual.format?.startsWith("TypedArray:") ?? false);
}

/**
 * Computes the `ADD COLUMN` steps that bring a live database up to the declared
 * schema. Pure — takes the declared tables and the live column names and returns
 * plan entries; it never touches a database and never warns.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op once a table exists, and
 * `createStorage` passes no `tabularMigrations`, so a column added to a schema
 * after a database was created never appears in it. Nothing else closes that
 * gap: `planColumnAlignment` explicitly skips a column the live schema lacks
 * (it aligns TYPES of existing columns), and every write goes through `putBulk`
 * with the full row, so the first write after the schema change fails outright.
 * That is not hypothetical — `spac_candidate.signal_filed_sic_6770` broke
 * `sec update` on every pre-existing database.
 *
 * Two safety rails, both load-bearing:
 *
 * 1. **Only NULLABLE columns are planned.** SQLite rejects `ADD COLUMN NOT NULL`
 *    without a default, and there is no honest default for a signal nobody has
 *    computed for the existing rows — writing one would state a value the data
 *    does not support. A NOT NULL addition needs a hand-written migration that
 *    decides what the backfill means.
 * 2. **An unmappable declared type is skipped, never guessed.** A column created
 *    at the wrong type is worse than a missing one: the missing column fails
 *    loudly on the next write, while a wrong type mismatches silently until a
 *    value does not fit. The executors warn and tell the operator to
 *    `sec db reset` or write a migration — the same posture
 *    `alignPostgresColumnTypes` takes for an ALTER a dependent view blocks.
 *
 * Non-goals, all of them deliberate: NOT NULL columns, type changes (that is
 * `alignPostgresColumnTypes`), drops, renames, and backfills.
 *
 * @param liveByTable Live column names per table. A table absent from the map
 * does not exist yet and is skipped — `setupDatabase()` creates it whole.
 */
export function planMissingColumns(
  declared: ReadonlyArray<RegisteredTable>,
  liveByTable: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlyArray<MissingColumn> {
  const plan: MissingColumn[] = [];
  for (const entry of declared) {
    const liveColumns = liveByTable.get(entry.table);
    if (!liveColumns) continue;

    const schema = entry.schema as unknown as ObjectSchema;
    for (const [column, typeDef] of Object.entries(schema.properties ?? {})) {
      if (liveColumns.has(column)) continue;

      if (!declaredNullable(schema, column, entry.primaryKeyNames)) {
        plan.push({
          table: entry.table,
          column,
          sqlite: null,
          postgres: null,
          unsupported: entry.primaryKeyNames.includes(column)
            ? "it is a primary-key column, so it is always NOT NULL"
            : "it is declared NOT NULL, and there is no honest default to give " +
              "the rows already stored",
        });
        continue;
      }

      const sqlite = sqliteColumnType(typeDef);
      const postgres = postgresColumnType(typeDef);
      if (sqlite === null || postgres === null) {
        plan.push({
          table: entry.table,
          column,
          sqlite: null,
          postgres: null,
          unsupported: "declared type is not mapped by the add-column pass",
        });
        continue;
      }
      plan.push({ table: entry.table, column, sqlite, postgres, unsupported: null });
    }
  }
  return plan;
}

/** The warning an executor prints for a plan entry it cannot apply. */
function warnUnsupported(step: MissingColumn): void {
  console.warn(
    `db setup: cannot add missing column ${step.table}.${step.column} — ${step.unsupported}. ` +
      `Add a hand-written migration, or recreate the database with \`sec db reset\` && ` +
      `\`sec db setup\` if it holds nothing you need.`
  );
}

/**
 * Adds every missing nullable column to an existing SQLite database.
 *
 * Reads `PRAGMA table_info` per registered table: a table the pragma reports no
 * columns for does not exist, so it is left to `setupDatabase()`.
 */
export function addMissingColumnsSqlite(db: Sqlite.Database): void {
  const declared = listRegisteredTables();
  const liveByTable = new Map<string, ReadonlySet<string>>();
  for (const entry of declared) {
    const columns = db.prepare<[], { name: string }>(`PRAGMA table_info(\`${entry.table}\`)`).all();
    if (columns.length === 0) continue; // table not created yet
    liveByTable.set(entry.table, new Set(columns.map((c) => c.name)));
  }

  for (const step of planMissingColumns(declared, liveByTable)) {
    if (step.sqlite === null) {
      warnUnsupported(step);
      continue;
    }
    try {
      db.exec(`ALTER TABLE \`${step.table}\` ADD COLUMN \`${step.column}\` ${step.sqlite}`);
    } catch (err) {
      // Never abort `db setup` over one column: everything after this call —
      // the view DDL, the resolver seeding, the component-version rows — is
      // unrelated to it, and the failure is reported rather than swallowed.
      console.warn(
        `db setup: skipped adding ${step.table}.${step.column} — ${
          err instanceof Error ? err.message : String(err)
        }. Resolve it and re-run \`sec db setup\`.`
      );
    }
  }
}

/** Adds every missing nullable column to an existing Postgres database. */
export async function addMissingColumnsPostgres(): Promise<void> {
  const declared = listRegisteredTables();
  if (declared.length === 0) return;

  const pool = getPgPool();
  const schema = await currentSchemaName(pool, "db setup");
  const catalog = await pool.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])`,
    [declared.map((t) => t.table)]
  );

  const liveByTable = new Map<string, Set<string>>();
  for (const row of catalog.rows as { table_name: string; column_name: string }[]) {
    const existing = liveByTable.get(row.table_name);
    if (existing) existing.add(row.column_name);
    else liveByTable.set(row.table_name, new Set([row.column_name]));
  }

  for (const step of planMissingColumns(declared, liveByTable)) {
    if (step.postgres === null) {
      warnUnsupported(step);
      continue;
    }
    // Schema-qualified. `information_schema` was read `WHERE table_schema =
    // current_schema()`, so an unqualified ALTER would ask a different question
    // than the one that decided the column is missing: on a deployment whose
    // search_path lists another schema first, it resolves — and alters — that
    // schema's same-named table.
    const sql =
      `ALTER TABLE "${quote(schema)}"."${quote(step.table)}" ` +
      `ADD COLUMN IF NOT EXISTS "${quote(step.column)}" ${step.postgres}`;
    try {
      await pool.query(sql);
    } catch (err) {
      console.warn(
        `db setup: skipped \`${sql}\` — ${
          err instanceof Error ? err.message : String(err)
        }. Resolve it and re-run \`sec db setup\`.`
      );
    }
  }
}

/**
 * Whether this process is configured for the given backend and may issue raw
 * DDL. Raw DDL reaches around the repository layer, so the `--dry-run`
 * `ReadOnlyTabularStorage` wrapper cannot intercept it — the guard has to be
 * explicit, exactly as in `alignPostgresColumnTypes`.
 */
export function shouldAddMissingColumns(backend: "sqlite" | "postgres"): boolean {
  if (isDryRun()) return false;
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : "sqlite";
  return dbType === backend;
}
