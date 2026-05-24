/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_TYPE } from "../../config/tokens";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import { CIK_NAME_REPOSITORY_TOKEN } from "./CikNameSchema";

export interface CikNameRow {
  readonly cik: number;
  readonly name: string;
}

export interface CikNameBulkWriter {
  writeBatch(rows: ReadonlyArray<CikNameRow>): Promise<void>;
  close(): Promise<void>;
}

/**
 * Picks the right writer for the active backend. The SQLite and Postgres
 * paths bypass the generic `ITabularStorage.putBulk` (which does one
 * round-trip and one event emit per row — fine for hundreds, untenable for
 * the ~1M rows in `cik-lookup-data.txt`). The in-memory fallback covers
 * tests where `SEC_DB_TYPE` is unregistered.
 *
 * The previous implementation always reached into `getDb()`, which silently
 * wrote ~1M rows into a SQLite file even when `SEC_DB_TYPE=postgres`
 * because `getDb()` ignored the type token. `getDb()` now throws when
 * dbType isn't sqlite, so this dispatch is also the safety net for that
 * regression.
 */
export function createCikNameBulkWriter(): CikNameBulkWriter {
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  // SQLite fast path needs SEC_DB_FOLDER to be configured (getDb() requires
  // it). When the test harness leaves SEC_DB_TYPE=sqlite registered as the
  // default but the rest of the production config is absent — e.g. in unit
  // tests that exercise this task without standing up a real DB — fall
  // through to the repository-backed writer instead of crashing in getDb().
  if (dbType === "sqlite" && globalServiceRegistry.has(SEC_DB_FOLDER)) {
    return createSqliteWriter();
  }
  if (dbType === "postgres") {
    return createPostgresWriter();
  }
  return createRepositoryWriter();
}

function createSqliteWriter(): CikNameBulkWriter {
  const db = getDb();
  const stmt = db.prepare<[number, string], unknown>(
    "INSERT OR REPLACE INTO `cik_names` (`cik`, `name`) VALUES (?, ?)"
  );
  const insertBatch = db.transaction((rows: ReadonlyArray<CikNameRow>) => {
    for (const row of rows) {
      stmt.run(row.cik, row.name);
    }
  });
  return {
    async writeBatch(rows: ReadonlyArray<CikNameRow>): Promise<void> {
      insertBatch(rows);
    },
    async close(): Promise<void> {
      // The prepared statement is owned by the shared db handle; finalising
      // it would invalidate other readers in this process.
    },
  };
}

function createPostgresWriter(): CikNameBulkWriter {
  // Postgres caps a single statement at 65535 bind parameters, so an inner
  // sub-batch of ~30000 rows (60000 params @ 2/row) is the safe ceiling.
  // Callers may pass batches larger than this; we slice internally.
  const PG_MAX_ROWS_PER_STATEMENT = 30_000;
  const pool = getPgPool();

  return {
    async writeBatch(rows: ReadonlyArray<CikNameRow>): Promise<void> {
      if (rows.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let start = 0; start < rows.length; start += PG_MAX_ROWS_PER_STATEMENT) {
          const slice = rows.slice(start, start + PG_MAX_ROWS_PER_STATEMENT);
          const values: (number | string)[] = [];
          const placeholders: string[] = [];
          for (let i = 0; i < slice.length; i++) {
            const base = i * 2;
            placeholders.push(`($${base + 1}, $${base + 2})`);
            values.push(slice[i].cik, slice[i].name);
          }
          const sql =
            `INSERT INTO "cik_names" ("cik", "name") VALUES ` +
            placeholders.join(", ") +
            ` ON CONFLICT ("cik") DO UPDATE SET "name" = EXCLUDED."name"`;
          await client.query(sql, values);
        }
        await client.query("COMMIT");
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore — primary error below is the meaningful one
        }
        throw e;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      // Pool lifetime is managed by closePgPool() at CLI shutdown.
    },
  };
}

function createRepositoryWriter(): CikNameBulkWriter {
  const repo = globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
  return {
    async writeBatch(rows: ReadonlyArray<CikNameRow>): Promise<void> {
      if (rows.length === 0) return;
      await repo.putBulk(rows.map((r) => ({ cik: r.cik, name: r.name })));
    },
    async close(): Promise<void> {},
  };
}
