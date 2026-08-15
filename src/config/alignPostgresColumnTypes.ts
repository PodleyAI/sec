/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { getPgPool } from "../util/pg";
import { currentSchemaName, quote } from "../util/pgIdentifiers";
import { listRegisteredTables, type RegisteredTable } from "./tableRegistry";
import { SEC_DB_TYPE } from "./tokens";

/**
 * One column as Postgres currently has it, read from `information_schema.columns`.
 */
export interface LiveColumn {
  readonly table: string;
  readonly column: string;
  /** `character_maximum_length`: the `n` of a `varchar(n)`, or null for an unbounded type. */
  readonly characterMaximumLength: number | null;
  readonly isNullable: boolean;
}

/** A single `ALTER TABLE` the live schema needs to catch up with the declared one. */
export interface ColumnAlignment {
  readonly table: string;
  readonly column: string;
  /**
   * `widen` / `unbound` change the column's TYPE and are the only kinds a
   * dependent view can block; `drop-not-null` only flips `attnotnull` and is
   * always allowed.
   */
  readonly kind: "widen" | "unbound" | "drop-not-null";
  /** Target `varchar` width. Present only for `kind: "widen"`. */
  readonly width: number | undefined;
  readonly sql: string;
}

/** Minimal structural view of a JSON-Schema property, enough to mirror the DDL rules. */
export interface PropertySchema {
  readonly type?: string | ReadonlyArray<string>;
  readonly format?: string;
  readonly contentEncoding?: string;
  readonly maxLength?: number;
  // Numeric keywords. The widening rules here never read them (a number has no
  // varchar width to widen), but `addMissingColumns` does — it shares this
  // shape so the two passes cannot drift onto different views of one schema.
  readonly multipleOf?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly anyOf?: ReadonlyArray<PropertySchema>;
  readonly oneOf?: ReadonlyArray<PropertySchema>;
}

export interface ObjectSchema {
  readonly properties?: Record<string, PropertySchema>;
  readonly required?: ReadonlyArray<string>;
}

/**
 * Map key for one column. Shared by every `(table, column)`-keyed lookup here,
 * so two of them cannot silently drift onto different separators and stop
 * matching. `::` cannot appear in the `[a-z0-9_]` identifiers the storage layer
 * emits, so the key is unambiguous.
 */
function columnKey(ref: { readonly table: string; readonly column: string }): string {
  return `${ref.table}::${ref.column}`;
}

/** Extracts the non-null branch of a `T | null` union, mirroring the storage layer. */
export function nonNullType(typeDef: PropertySchema): PropertySchema {
  // `anyOf` then `oneOf`, probed independently — the storage layer's
  // `getNonNullType` falls through from one to the other rather than
  // committing to whichever is present.
  for (const branches of [typeDef.anyOf, typeDef.oneOf]) {
    const nonNull = branches?.find((t) => t.type !== "null");
    if (nonNull) return nonNull;
  }
  return typeDef;
}

/** Whether the schema admits null, mirroring the storage layer's nullability probe. */
export function admitsNull(typeDef: PropertySchema): boolean {
  if (typeDef.type === "null") return true;
  if (Array.isArray(typeDef.type)) return typeDef.type.includes("null");
  // `anyOf` and `oneOf` are probed independently, as the storage layer does: an
  // `anyOf` with no null branch must not stop a null `oneOf` branch from
  // counting, or this mirror would call a column NOT NULL that the DDL emits
  // as nullable and then never relax it.
  if (typeDef.anyOf?.some((t) => t.type === "null")) return true;
  if (typeDef.oneOf?.some((t) => t.type === "null")) return true;
  return false;
}

/**
 * The `n` this property's column is declared as `varchar(n)` with, or undefined
 * when the property maps to any other Postgres type.
 *
 * Mirrors the storage layer's JSON-Schema → column-type rules: a blob encoding
 * or a string `format` is decided first and wins over `maxLength`, and a string
 * with no `maxLength` is unbounded TEXT. Anything that is not a bounded string
 * has no width to widen, so it is left alone.
 */
export function declaredVarcharWidth(typeDef: PropertySchema): number | undefined {
  const declared = declaredStringType(typeDef);
  return declared.kind === "varchar" ? declared.width : undefined;
}

/**
 * The declared column type, to the extent it matters here: a bounded
 * `varchar(n)`, an unbounded `text`, or anything else (nothing to align).
 */
export function declaredStringType(
  typeDef: PropertySchema
): { kind: "varchar"; width: number } | { kind: "text" } | { kind: "other" } {
  const actual = nonNullType(typeDef);
  if (actual.contentEncoding === "blob") return { kind: "other" }; // BYTEA
  if (actual.type !== "string") return { kind: "other" };
  switch (actual.format) {
    case "date-time": // TIMESTAMP
    case "date": // DATE
    case "uuid": // UUID
      return { kind: "other" };
    case "email":
      return { kind: "varchar", width: 255 };
    case "uri":
      return { kind: "varchar", width: 2048 };
    default:
      break;
  }
  // Typed-array formats become a pgvector column, never a varchar.
  if (actual.format === "TypedArray" || actual.format?.startsWith("TypedArray:")) {
    return { kind: "other" };
  }
  // A string with no `maxLength` is unbounded TEXT in the DDL.
  return typeof actual.maxLength === "number"
    ? { kind: "varchar", width: actual.maxLength }
    : { kind: "text" };
}

/**
 * Whether the declared DDL would leave this column nullable. Mirrors the
 * storage layer: primary-key columns are always NOT NULL, and a value column
 * is nullable when it is absent from `required` or its schema admits null.
 */
export function declaredNullable(
  schema: ObjectSchema,
  column: string,
  primaryKeyNames: ReadonlyArray<string>
): boolean {
  if (primaryKeyNames.includes(column)) return false;
  const typeDef = schema.properties?.[column];
  if (!typeDef) return false;
  const required = new Set(schema.required ?? []);
  return !required.has(column) || admitsNull(typeDef);
}

/**
 * Computes the `ALTER TABLE` steps that bring a live Postgres schema up to the
 * declared one. Pure — takes the declared tables and the live catalog rows and
 * returns statements; it never touches a database.
 *
 * The plan is deliberately one-directional: it only ever WIDENS a `varchar`
 * (including all the way to unbounded `text`, when the schema dropped its
 * `maxLength`) and only ever DROPS a `NOT NULL`. Narrowing would fail on stored
 * data that already exceeds the target, and re-tightening would fail on rows
 * that are already null — neither is something a `db setup` may attempt. That
 * one-directionality is also what makes the pass idempotent: once applied, or
 * on a freshly created database, every column is already at or beyond the
 * declared shape and the plan is empty.
 *
 * A column the live schema does not have yet is skipped: this pass aligns the
 * TYPES of columns that exist. `setupDatabase()` creates a new table whole, and
 * `addMissingColumns` adds a nullable column to a table that already exists.
 *
 * @param schema The schema every statement is qualified with — required, and
 * required to be the one the catalog was read from. An unqualified `ALTER TABLE`
 * resolves through the `search_path`, so on a deployment listing another schema
 * first it would alter a different schema's same-named table than the one whose
 * catalog said the column was narrow. The caller resolves it once per run.
 */
export function planColumnAlignment(
  declared: ReadonlyArray<RegisteredTable>,
  live: ReadonlyArray<LiveColumn>,
  schema: string
): ReadonlyArray<ColumnAlignment> {
  const qualified = `"${quote(schema)}"`;
  const liveByKey = new Map<string, LiveColumn>();
  for (const col of live) {
    liveByKey.set(columnKey(col), col);
  }

  const plan: ColumnAlignment[] = [];
  for (const entry of declared) {
    const schema = entry.schema as unknown as ObjectSchema;
    const properties = schema.properties ?? {};
    for (const column of Object.keys(properties)) {
      const liveColumn = liveByKey.get(columnKey({ table: entry.table, column }));
      if (!liveColumn) continue;

      const declaredType = declaredStringType(properties[column]!);
      if (
        declaredType.kind === "varchar" &&
        liveColumn.characterMaximumLength !== null &&
        liveColumn.characterMaximumLength < declaredType.width
      ) {
        plan.push({
          table: entry.table,
          column,
          kind: "widen",
          width: declaredType.width,
          sql: `ALTER TABLE ${qualified}."${quote(entry.table)}" ALTER COLUMN "${quote(column)}" TYPE varchar(${declaredType.width})`,
        });
      }

      // The schema dropped `maxLength` (the column is now unbounded TEXT) but
      // the live column is still a bounded varchar — the same overflow the
      // widening branch fixes, just with no target width to compare against.
      // Also one-directional: text is strictly wider than any varchar(n).
      if (declaredType.kind === "text" && liveColumn.characterMaximumLength !== null) {
        plan.push({
          table: entry.table,
          column,
          kind: "unbound",
          width: undefined,
          sql: `ALTER TABLE ${qualified}."${quote(entry.table)}" ALTER COLUMN "${quote(column)}" TYPE text`,
        });
      }

      if (declaredNullable(schema, column, entry.primaryKeyNames) && !liveColumn.isNullable) {
        plan.push({
          table: entry.table,
          column,
          kind: "drop-not-null",
          width: undefined,
          sql: `ALTER TABLE ${qualified}."${quote(entry.table)}" ALTER COLUMN "${quote(column)}" DROP NOT NULL`,
        });
      }
    }
  }
  return plan;
}

/**
 * Brings an existing Postgres database's column types up to the currently
 * declared schema.
 *
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, so a database
 * created before a column was widened or relaxed keeps the old shape forever
 * and re-hits the original overflow — a `STORE_ERROR` that loses a whole CIK's
 * data, or a rejected filing. The declarative migration op set cannot express
 * either change (no `alterColumn`, and a rewrite-based emulation is impossible
 * for a primary-key column), so this pass issues the `ALTER TABLE` directly,
 * driven off the schemas registered by `createStorage`.
 *
 * Postgres-only: SQLite emits TEXT (no length enforcement, and its own NOT
 * NULL relaxations need a table rebuild — see the per-table migrations), and
 * the in-memory test backend has no column types at all.
 *
 * Operational note: widening a `varchar` is binary-coercible, so the heap is
 * not rewritten — but every index on the column is rebuilt under an ACCESS
 * EXCLUSIVE lock, including the unique index backing a primary key. On a large
 * table run this in a maintenance window.
 */
export async function alignPostgresColumnTypes(): Promise<void> {
  // Raw DDL reaches around the repository layer, so the dry-run
  // ReadOnlyTabularStorage wrapper cannot intercept it — bail explicitly.
  if (isDryRun()) return;

  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;
  if (dbType !== "postgres") return;

  const declared = listRegisteredTables();
  if (declared.length === 0) return;

  const pool = getPgPool();
  const client = await pool.connect();
  try {
    // Resolved once per run and threaded into every statement below. The
    // catalog query already scopes itself to `current_schema()`; an unqualified
    // ALTER would not, and the mismatch is invisible until the day someone puts
    // a staging schema ahead of sec's on the search path.
    const schema = await currentSchemaName(client, "db setup");
    const catalog = await client.query(
      `SELECT table_name, column_name, character_maximum_length, is_nullable
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ANY($1::text[])`,
      [declared.map((t) => t.table)]
    );
    const live: LiveColumn[] = catalog.rows.map(
      (row: {
        table_name: string;
        column_name: string;
        character_maximum_length: number | null;
        is_nullable: string;
      }) => ({
        table: row.table_name,
        column: row.column_name,
        characterMaximumLength: row.character_maximum_length,
        isNullable: row.is_nullable === "YES",
      })
    );

    const plan = planColumnAlignment(declared, live, schema);
    // One catalog probe for the whole plan rather than one per step, and only
    // when a type change is actually planned: `DROP NOT NULL` flips
    // `pg_attribute.attnotnull` and Postgres never refuses it over a dependent
    // view, so gating it on this probe would skip a relaxation nothing is
    // blocking — leaving exactly the NOT NULL rejection this pass exists to
    // fix in place for any operator who keeps a reporting view.
    const typeChanges = plan.filter((s) => s.kind !== "drop-not-null");
    const blockersByColumn =
      typeChanges.length > 0
        ? await dependentViewNames(
            client,
            typeChanges.map((s) => s.table),
            typeChanges.map((s) => s.column)
          )
        : new Map<string, string[]>();

    for (const step of plan) {
      const blockers =
        step.kind === "drop-not-null" ? [] : (blockersByColumn.get(columnKey(step)) ?? []);
      if (blockers.length > 0) {
        // A view built on the column makes Postgres refuse the ALTER. Warn and
        // move on rather than throw: a reporting view is a normal thing for an
        // operator to have, and aborting here would turn recoverable schema
        // drift into a hard `db setup` outage — and would also skip every
        // other alignment, including the ones nothing is blocking.
        console.warn(
          `db setup: skipped \`${step.sql}\` — dependent view(s) ${blockers
            .map((v) => `"${v}"`)
            .join(", ")} reference ${step.table}.${step.column}. ` +
            `Drop and recreate them, then re-run \`sec db setup\`.`
        );
        continue;
      }
      try {
        await client.query(step.sql);
      } catch (err) {
        // Same reasoning as the dependent-view skip above, for every other way
        // an ALTER can be refused: a role without ownership of the table, a
        // lock timeout under the ACCESS EXCLUSIVE lock, a dependency shape the
        // view probe does not model. Aborting here would propagate out of
        // `setupAllDatabases()` and skip everything that follows it — the view
        // DDL, the resolver seeding, the rate-limiter tables — over one column
        // nothing else depends on.
        console.warn(
          `db setup: skipped \`${step.sql}\` — ${
            err instanceof Error ? err.message : String(err)
          }. Resolve it and re-run \`sec db setup\`.`
        );
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Views whose definition reads one of the given `table.column` pairs, which
 * blocks an `ALTER COLUMN ... TYPE`. Keyed `"<table> <column>"`; one query for
 * the whole plan rather than a round trip per step.
 */
async function dependentViewNames(
  client: {
    query: (
      sql: string,
      params: unknown[]
    ) => Promise<{ rows: { table_name: string; column_name: string; view_name: string }[] }>;
  },
  tables: ReadonlyArray<string>,
  columns: ReadonlyArray<string>
): Promise<Map<string, string[]>> {
  const result = await client.query(
    `SELECT DISTINCT source.relname AS table_name,
                     a.attname      AS column_name,
                     dependent.relname AS view_name
       FROM pg_depend d
       JOIN pg_rewrite r ON r.oid = d.objid
       JOIN pg_class dependent ON dependent.oid = r.ev_class
       JOIN pg_class source ON source.oid = d.refobjid
       JOIN pg_namespace n ON n.oid = source.relnamespace
       JOIN pg_attribute a ON a.attrelid = source.oid AND a.attnum = d.refobjsubid
      WHERE d.classid = 'pg_rewrite'::regclass
        AND d.refclassid = 'pg_class'::regclass
        AND n.nspname = current_schema()
        AND source.relname = ANY($1::text[])
        AND a.attname = ANY($2::text[])
        AND dependent.relname <> source.relname`,
    [[...new Set(tables)], [...new Set(columns)]]
  );
  const byColumn = new Map<string, string[]>();
  for (const row of result.rows) {
    const key = columnKey({ table: row.table_name, column: row.column_name });
    const existing = byColumn.get(key);
    if (existing) existing.push(row.view_name);
    else byColumn.set(key, [row.view_name]);
  }
  return byColumn;
}
