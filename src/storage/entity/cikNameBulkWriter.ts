/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import { resolveSqlBackend } from "../../util/sqlBackend";
import { CIK_NAME_REPOSITORY_TOKEN, type CikNameRepositoryStorage } from "./CikNameSchema";

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
 * `getDb()` throws when `dbType` isn't sqlite, so this dispatch is also the
 * safety net for that guard: it keeps a bulk write from reaching for a
 * SQLite-only path under a non-sqlite backend.
 */
export function createCikNameBulkWriter(): CikNameBulkWriter {
  // Resolved once: the repo is both the durability signal for the dispatch (a
  // non-durable in-memory binding forces the repository writer even under a
  // `SEC_DB_TYPE` that would otherwise select a raw-SQL path) and the
  // destination of that writer.
  const repo = globalServiceRegistry.has(CIK_NAME_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN)
    : undefined;
  const backend = resolveSqlBackend("write", repo);
  if (backend === "sqlite") return createSqliteWriter();
  if (backend === "postgres") return createPostgresWriter();
  // Unregistered token: let the registry raise its own error, as before.
  return createRepositoryWriter(repo ?? globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN));
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

// Postgres caps a single statement at 65535 bind parameters; we use 2
// per cik_names row (cik, name), so ~30000 rows is the safe ceiling.
// Callers may pass batches larger than this; the writer slices internally.
const PG_MAX_ROWS_PER_STATEMENT = 30_000;

function createPostgresWriter(): CikNameBulkWriter {
  const pool = getPgPool();

  return {
    async writeBatch(rows: ReadonlyArray<CikNameRow>): Promise<void> {
      if (rows.length === 0) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (let start = 0; start < rows.length; start += PG_MAX_ROWS_PER_STATEMENT) {
          const slice = rows.slice(start, start + PG_MAX_ROWS_PER_STATEMENT);
          // Per-slice dedup keeps `INSERT ... ON CONFLICT DO UPDATE` from
          // failing on duplicate CIKs within a single statement (Postgres
          // rejects two rows with the same conflict key in one INSERT).
          // Last value wins, matching the SQLite `INSERT OR REPLACE` path.
          // Dedup runs AFTER slicing and only shrinks the row set, so the
          // 60_000-bind cap (PG_MAX_ROWS_PER_STATEMENT * 2) still holds.
          const dedup = new Map<number, string>();
          for (const r of slice) dedup.set(r.cik, r.name);
          if (dedup.size < slice.length) {
            console.debug(
              `cikNameBulkWriter: dedup dropped ${slice.length - dedup.size} duplicate cik(s) within a ${slice.length}-row slice`
            );
          }
          if (dedup.size === 0) continue;
          const values: (number | string)[] = [];
          const placeholders: string[] = [];
          let i = 0;
          for (const [cik, name] of dedup.entries()) {
            const base = i * 2;
            placeholders.push(`($${base + 1}, $${base + 2})`);
            values.push(cik, name);
            i++;
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

function createRepositoryWriter(repo: CikNameRepositoryStorage): CikNameBulkWriter {
  return {
    async writeBatch(rows: ReadonlyArray<CikNameRow>): Promise<void> {
      if (rows.length === 0) return;
      await repo.putBulk(rows.map((r) => ({ cik: r.cik, name: r.name })));
    },
    async close(): Promise<void> {},
  };
}
