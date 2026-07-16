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

/**
 * Rewrites a legacy `person_observations.title` (TEXT) column into the current
 * `person_observations.titles` array column. The rename happened in-place with
 * no ALTER TABLE, so an operator with a pre-existing database would either
 * (a) see the next `observePerson` write fail on "column titles does not
 * exist" or (b) keep writing while the older `title` data was orphaned.
 *
 * The probe is structural: if `titles` is already present and `title` is
 * gone, the migration is a no-op — a fresh DB (created by the current
 * `setupDatabase()` call that runs immediately afterwards) also exits before
 * emitting any log. A partially-migrated shape (both columns present) is
 * treated the same as the pre-migration shape and reconciled: rows where
 * `titles` is still null are backfilled from `title`, rows that already carry
 * a `titles` value are left alone, and the legacy column is dropped.
 */
export async function migrateLegacyPersonObservationsTitles(): Promise<void> {
  // Same reasoning as the 8-K migration: raw ALTER/UPDATE bypasses the
  // repository layer's ReadOnlyTabularStorage wrapper, so --dry-run cannot
  // observe or intercept the write. Bail explicitly.
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
  // In-memory / other backend: nothing to migrate.
}

function migrateSqlite(): void {
  const db = getDb();
  const tableExistsRow = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='person_observations'`
    )
    .get();
  if (!tableExistsRow) return;
  const columns = db.prepare<[], { name: string }>(`PRAGMA table_info(person_observations)`).all();
  const hasTitles = columns.some((c) => c.name === "titles");
  const hasTitle = columns.some((c) => c.name === "title");
  if (hasTitles && !hasTitle) return;

  db.exec("BEGIN");
  try {
    if (!hasTitles) {
      db.exec(`ALTER TABLE person_observations ADD COLUMN titles TEXT`);
    }
    let backfilled = 0;
    if (hasTitle) {
      db.exec(
        `UPDATE person_observations SET titles = json_array(title) WHERE title IS NOT NULL AND titles IS NULL`
      );
      const changes = db.prepare<[], { n: number }>(`SELECT changes() AS n`).get();
      backfilled = changes?.n ?? 0;
      db.exec(`ALTER TABLE person_observations DROP COLUMN title`);
    }
    db.exec("COMMIT");
    // Only announce a real migration; a fresh DB (no `title` and no rows)
    // stays silent so first-run bootstrap does not spam operator output.
    if (hasTitle) {
      // eslint-disable-next-line no-console
      console.info(
        `[migration] person_observations: dropped legacy \`title\` column (${backfilled} row(s) backfilled into \`titles\`)`
      );
    } else if (!hasTitles) {
      // eslint-disable-next-line no-console
      console.info(`[migration] person_observations: added \`titles\` column`);
    }
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

async function migratePostgres(): Promise<void> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    const exists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'person_observations'`
    );
    if (exists.rowCount === 0) return;
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'person_observations'`
    );
    const columnSet = new Set(cols.rows.map((r: { column_name: string }) => r.column_name));
    const hasTitles = columnSet.has("titles");
    const hasTitle = columnSet.has("title");
    if (hasTitles && !hasTitle) return;

    await client.query("BEGIN");
    try {
      // The current schema emits JSONB for the titles array (VARCHAR(n) is
      // explicitly excluded from the native-array whitelist in mapPostgresType),
      // so match that shape here.
      await client.query(
        `ALTER TABLE "person_observations" ADD COLUMN IF NOT EXISTS "titles" JSONB`
      );
      let backfilled = 0;
      if (hasTitle) {
        const updated = await client.query(
          `UPDATE "person_observations" SET "titles" = jsonb_build_array("title") WHERE "title" IS NOT NULL AND "titles" IS NULL`
        );
        backfilled = updated.rowCount ?? 0;
        await client.query(`ALTER TABLE "person_observations" DROP COLUMN IF EXISTS "title"`);
      }
      await client.query("COMMIT");
      if (hasTitle) {
        // eslint-disable-next-line no-console
        console.info(
          `[migration] person_observations: dropped legacy "title" column (${backfilled} row(s) backfilled into "titles")`
        );
      } else if (!hasTitles) {
        // eslint-disable-next-line no-console
        console.info(`[migration] person_observations: added "titles" column`);
      }
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  } finally {
    client.release();
  }
}
