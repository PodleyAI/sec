/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { getDb } from "../../util/db";
import { currentSchemaName, quote } from "../../util/pgIdentifiers";
import { getPgPool } from "../../util/pg";

const TABLE = "rega_offerings";
const COLUMN = "securities_offered_type";

/**
 * Converts `rega_offerings.securities_offered_type` from the scalar column it
 * was declared as into the list it always was.
 *
 * Form 1-A declares `securitiesOfferedTypes` `maxOccurs="6"`, so a filer
 * selecting two securities produced two values. Stored through a
 * `varchar(100)`, the pair was stringified into a Postgres array literal that
 * overflowed the width — 57 Form 1-A filings failed with `STORE_ERROR` — and
 * every surviving multi-select was unqueryable as the list it is.
 *
 * Neither generic catch-up pass in `db setup` can express this. `CREATE TABLE
 * IF NOT EXISTS` never alters an existing table; `planMissingColumns` only
 * ADDs; and `planColumnAlignment` acts only on columns `declaredStringType()`
 * recognizes, which reports `other` for an array. Teaching that planner about
 * arrays would mean re-deriving the storage layer's array DDL rules from
 * memory, which is precisely what the `schemaTypeMirror` allowlist exists to
 * refuse. So this is one hand-rolled, named migration, like
 * {@link migrateAddressRegionNullable} and `backfillExtractorRunsOutcome`.
 *
 * The two backends converge on what the repository hands back — a `string[]` —
 * while storing it differently:
 *
 * - **Postgres**: one `ALTER COLUMN ... TYPE text[]`, with a `USING` clause
 *   that maps a bare scalar to a one-element array and re-parses a value that
 *   is already an array literal. Safe by construction: Postgres REJECTS an
 *   over-length value rather than truncating it (that rejection IS the 57
 *   `STORE_ERROR`s), so every value that made it into the column is complete —
 *   either a bare scalar or a well-formed literal. There is no truncated
 *   literal to defend against.
 * - **SQLite**: no DDL at all. The column is TEXT either way and
 *   `SqliteTabularStorage` already JSON-stringifies arrays, so a legacy
 *   multi-select was written as a JSON array and already reads back correctly.
 *   Only a legacy SINGLE selection is wrong — a bare string that `sqlToJsValue`
 *   returns raw — so one `UPDATE` wraps those in a JSON array.
 *
 * Idempotent on both: a fresh or already-converted database is a no-op.
 *
 * ⚠️ Unlike the `varchar` widenings `planColumnAlignment` issues, this ALTER is
 * NOT binary-coercible — Postgres rewrites the heap under an ACCESS EXCLUSIVE
 * lock. Run `db setup` in a maintenance window on a large deployment.
 */
export async function migrateRegASecuritiesOfferedTypeArray(): Promise<void> {
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
  // In-memory backend: values are held as JS objects, so there is no encoding
  // to convert.
}

async function migratePostgres(): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    // Scoped to `current_schema()`: `information_schema` spans every schema the
    // role can see, so a same-named table elsewhere on the search_path would
    // otherwise decide this probe while the ALTER hits a different table.
    const info = await client.query(
      `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = $1 AND column_name = $2`,
      [TABLE, COLUMN]
    );
    // Fresh database (nothing created yet) or already converted → skip.
    if (info.rowCount === 0 || info.rows[0]?.data_type === "ARRAY") return;

    const schema = await currentSchemaName(client, "db setup");
    const col = `"${quote(COLUMN)}"`;
    await client.query(
      `ALTER TABLE "${quote(schema)}"."${quote(TABLE)}"
         ALTER COLUMN ${col} TYPE text[]
         USING CASE
                 WHEN ${col} IS NULL THEN NULL
                 WHEN btrim(${col}) = '' THEN NULL
                 WHEN ${col} ~ '^\\{.*\\}$' THEN ${col}::text[]
                 ELSE ARRAY[${col}]
               END`
    );
  } catch (err) {
    throw wrapConversionError(err);
  } finally {
    client.release();
  }
}

function wrapConversionError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(
    `db setup: converting \`${TABLE}.${COLUMN}\` to a list failed and was rolled back — ` +
      `\`${TABLE}\` is unchanged. Set the column NULL for the offending rows and re-run ` +
      `\`sec db setup\`; \`sec extractor backfill 1-A --force\` refills them from the ` +
      `filings. Cause: ${msg}`
  );
  if (err instanceof Error) wrapped.cause = err;
  return wrapped;
}

async function migrateSqlite(): Promise<void> {
  const db = getDb();
  const table = db
    .prepare<
      [],
      { name: string }
    >(`SELECT name FROM sqlite_master WHERE type='table' AND name='${TABLE}'`)
    .get();
  if (!table) return; // fresh database

  // A legacy MULTI-selection was already written as a JSON array (the storage
  // layer stringifies arrays regardless of the declared type), so only a bare
  // scalar needs wrapping. `json_valid(x) AND json_type(x)='array'` is what
  // makes the statement idempotent — a second run matches nothing.
  const result = db
    .prepare(
      `UPDATE ${TABLE}
          SET ${COLUMN} = json_array(${COLUMN})
        WHERE ${COLUMN} IS NOT NULL
          AND NOT (json_valid(${COLUMN}) AND json_type(${COLUMN}) = 'array')`
    )
    .run();
  const changed = Number(result.changes ?? 0);
  if (changed > 0) {
    console.warn(`db setup: wrapped ${changed} scalar \`${TABLE}.${COLUMN}\` value(s) as a list`);
  }
}
