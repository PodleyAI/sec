/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { getPgPool } from "../util/pg";
import { currentSchemaName, quote } from "../util/pgIdentifiers";
import { nonNullType, type ObjectSchema, type PropertySchema } from "./alignPostgresColumnTypes";
import { listRegisteredTables, type RegisteredTable } from "./tableRegistry";
import { SEC_DB_TYPE } from "./tokens";

/** One CHECK constraint as Postgres currently has it, read from `pg_constraint`. */
export interface LiveCheckConstraint {
  readonly table: string;
  readonly name: string;
  /** `pg_get_constraintdef`, e.g. `CHECK ((cik >= 0))`. */
  readonly definition: string;
  /** Columns the constraint references. A bound this pass owns names exactly one. */
  readonly columns: ReadonlyArray<string>;
}

/** One `DROP CONSTRAINT` a live database needs to catch up with the declared schema. */
export interface StaleCheckDrop {
  readonly table: string;
  readonly column: string;
  readonly name: string;
  readonly sql: string;
}

/**
 * Whether the storage layer would emit a `CHECK (col >= 0)` for this column.
 *
 * Mirrors `BaseSqlTabularStorage.shouldBeUnsigned` exactly — a numeric type
 * with a `minimum` of 0 or more — because this pass drops a constraint only
 * when the answer has flipped to false. A mirror that drifted OPTIMISTIC would
 * drop a bound the emitter still wants and a fresh database would still have,
 * which is drift in the direction this pass exists to remove.
 */
export function declaredUnsigned(typeDef: PropertySchema): boolean {
  const actual = nonNullType(typeDef);
  return (
    (actual.type === "number" || actual.type === "integer") &&
    typeof actual.minimum === "number" &&
    actual.minimum >= 0
  );
}

/**
 * True when `definition` is the exact shape the emitter writes for an unsigned
 * column, and nothing else.
 *
 * This is the pass's only safety rail, so it is deliberately literal. Postgres
 * renders the emitted constraint as `CHECK ((col >= 0))`, with a `(0)::numeric`
 * cast when the column is `numeric` — those two, modulo whitespace and
 * quoting, are all that may be dropped. A hand-written `CHECK ((v >= 0) AND
 * (v <= 100))`, a multi-column check, or anything an operator added themselves
 * fails to match and is left standing: this pass removes bounds the storage
 * layer put there and later stopped declaring, and it has no opinion about
 * anyone else's.
 */
export function isEmittedUnsignedCheck(definition: string, column: string): boolean {
  const normalized = definition
    .replace(/::\s*(numeric|bigint|integer|smallint|double precision|real)/g, "")
    .replace(/[()"\s]/g, "");
  return normalized === `CHECK${column}>=0`.replace(/\s/g, "");
}

/**
 * The `DROP CONSTRAINT`s that bring a live database's CHECK bounds back in
 * line with the declared schema.
 *
 * Only a constraint on a column the schema still DECLARES is considered. A
 * constraint on a column the schema knows nothing about belongs to something
 * else — an operator's own, or a table sec merely shares a name with — and
 * dropping it would be this pass reaching outside what it owns.
 */
export function planStaleCheckDrops(
  declared: ReadonlyArray<RegisteredTable>,
  live: ReadonlyArray<LiveCheckConstraint>,
  schema: string
): ReadonlyArray<StaleCheckDrop> {
  const qualified = `"${quote(schema)}"`;
  const propertiesByTable = new Map<string, Record<string, PropertySchema>>();
  for (const entry of declared) {
    propertiesByTable.set(entry.table, (entry.schema as unknown as ObjectSchema).properties ?? {});
  }

  const plan: StaleCheckDrop[] = [];
  for (const constraint of live) {
    if (constraint.columns.length !== 1) continue;
    const column = constraint.columns[0]!;
    const properties = propertiesByTable.get(constraint.table);
    const typeDef = properties?.[column];
    if (typeDef === undefined) continue;
    if (!isEmittedUnsignedCheck(constraint.definition, column)) continue;
    if (declaredUnsigned(typeDef)) continue;
    plan.push({
      table: constraint.table,
      column,
      name: constraint.name,
      sql: `ALTER TABLE ${qualified}."${quote(constraint.table)}" DROP CONSTRAINT "${quote(constraint.name)}"`,
    });
  }
  return plan;
}

/**
 * Drops `CHECK (col >= 0)` bounds the schema no longer declares.
 *
 * The third catch-up pass, and the one whose absence is hardest to see.
 * `CREATE TABLE IF NOT EXISTS` never alters an existing table, and neither of
 * the other two passes touches a constraint — `addMissingColumns` adds columns
 * and `alignPostgresColumnTypes` widens types and drops NOT NULL. So relaxing a
 * `minimum: 0` in a schema fixed every FRESH database and no existing one,
 * forever.
 *
 * What made that worth a pass of its own is the failure mode. A rejected write
 * inside a multi-row store is not a clean error: `crowdfunding_reports` writes
 * its eighteen financial disclosures one row at a time, in declaration order,
 * with the four negative-capable ones (netIncome / taxPaid, both fiscal years)
 * LAST — so a loss-making Reg CF issuer committed its parent row, stored a
 * clean fifteen-row prefix, and dropped exactly the fields a reader wants. The
 * row count looked plausible and nothing downstream could tell.
 *
 * Postgres-only. SQLite has no `DROP CONSTRAINT`: its CHECKs are inline in the
 * `CREATE TABLE`, so removing one needs the rename/recreate/copy rebuild the
 * per-table migrations use (`AddressRegionNullableMigration` is the pattern).
 * A SQLite database therefore keeps a stale bound until such a migration is
 * written for it, which is the same deal `alignPostgresColumnTypes` offers.
 *
 * Idempotent: a database already matching the schema plans nothing.
 */
export async function dropStaleCheckConstraints(): Promise<void> {
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
    const schema = await currentSchemaName(client, "db setup");
    // `conkey` is resolved through `pg_attribute` rather than parsed out of the
    // constraint text: the text is for MATCHING the emitter's shape, and using
    // it to decide which column is involved would make a quoted or
    // funny-cased identifier read as a different column than it is.
    //
    // `attname::text` is load-bearing. `attname` is `name`, so aggregating it
    // yields `name[]`, an OID the driver has no parser for — it hands back the
    // literal `"{cik}"` instead of an array. Nothing errors: `columns` is typed
    // `string[]`, a string has a `.length`, and every constraint then fails the
    // single-column test and is silently skipped.
    const catalog = await client.query(
      `SELECT c.relname AS table_name,
              con.conname AS constraint_name,
              pg_get_constraintdef(con.oid) AS definition,
              coalesce(
                (SELECT array_agg(a.attname::text ORDER BY a.attnum)
                   FROM unnest(con.conkey) AS k(attnum)
                   JOIN pg_attribute a
                     ON a.attrelid = con.conrelid AND a.attnum = k.attnum),
                '{}'
              ) AS columns
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'c'
          AND n.nspname = current_schema()
          AND c.relname = ANY($1::text[])`,
      [declared.map((t) => t.table)]
    );
    const live: LiveCheckConstraint[] = catalog.rows.map(
      (row: {
        table_name: string;
        constraint_name: string;
        definition: string;
        columns: string[] | null;
      }) => ({
        table: row.table_name,
        name: row.constraint_name,
        definition: row.definition,
        columns: row.columns ?? [],
      })
    );

    for (const step of planStaleCheckDrops(declared, live, schema)) {
      // Reported rather than silent. Every other statement `db setup` issues
      // adds capability; this one removes a guarantee the database has been
      // enforcing, and an operator reading the log afterwards should be able to
      // see that it happened without diffing the catalog.
      console.warn(
        `db setup: dropping stale CHECK "${step.name}" on ${step.table}.${step.column} — ` +
          `the schema no longer bounds this column at >= 0.`
      );
      await client.query(step.sql);
    }
  } finally {
    client.release();
  }
}
