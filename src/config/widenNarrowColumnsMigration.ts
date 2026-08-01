/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../cli/isDryRun";
import { getPgPool } from "../util/pg";
import { SEC_DB_TYPE } from "./tokens";

/**
 * Columns whose TypeBox `maxLength` was widened after real EDGAR data
 * overflowed the original width. `CREATE TABLE IF NOT EXISTS` never alters an
 * existing table, so a Postgres database set up before the widening keeps the
 * narrow `varchar(N)` and re-hits the original overflow (a `STORE_ERROR` that
 * loses the whole CIK's facts, or a silently dropped XBRL fact, or a rejected
 * filings row that fails an entire submission). This migration brings existing
 * columns up to the current schema width.
 *
 * Postgres-only: SQLite emits `TEXT` (length never enforced) and the in-memory
 * test backend has no column types, so both are no-ops. Increasing a
 * `varchar` length in Postgres is a catalog-only change (no table rewrite), and
 * the guard skips columns already at or above the target, so this is cheap and
 * idempotent to run on every `db setup`.
 */
const WIDENED_COLUMNS: ReadonlyArray<{
  readonly table: string;
  readonly column: string;
  readonly width: number;
}> = [
  { table: "company_facts", column: "val_unit", width: 32 },
  { table: "company_facts", column: "grouping", width: 20 },
  { table: "xbrl_fact", column: "context_ref", width: 512 },
  { table: "phones", column: "international_number", width: 64 },
  { table: "canonical_person_phone", column: "international_number", width: 64 },
  { table: "canonical_company_phone", column: "international_number", width: 64 },
  { table: "filings", column: "form", width: 32 },
  { table: "filings", column: "file_number", width: 255 },
  { table: "filings", column: "film_number", width: 255 },
  { table: "filings", column: "primary_doc", width: 128 },
  { table: "filings", column: "primary_doc_description", width: 255 },
  { table: "filings", column: "act", width: 16 },
];

/**
 * Decide whether a column's current `character_maximum_length` needs to widen
 * to `target`. Extracted for unit testing.
 *
 * - `undefined` (column absent — table not created yet) → skip.
 * - `null` (unbounded text type) → skip; never narrow.
 * - `current >= target` → already wide enough, skip.
 * - `current < target` → widen.
 */
export function shouldWidenColumn(current: number | null | undefined, target: number): boolean {
  if (current === undefined) return false;
  if (current === null) return false;
  return current < target;
}

export async function widenNarrowColumns(): Promise<void> {
  // DDL through raw SQL reaches around the repository layer, so the dry-run
  // ReadOnlyTabularStorage wrapper cannot intercept it — bail explicitly.
  if (isDryRun()) return;

  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;
  if (dbType !== "postgres") return;

  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      for (const { table, column, width } of WIDENED_COLUMNS) {
        const info = await client.query(
          `SELECT character_maximum_length AS len
             FROM information_schema.columns
            WHERE table_name = $1 AND column_name = $2`,
          [table, column]
        );
        const current = info.rows[0]?.len as number | null | undefined;
        if (!shouldWidenColumn(current, width)) continue;
        await client.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE varchar(${width})`
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}
