/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, Sqlite } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";

/**
 * Outcome columns added to `processed_facts` after its initial release.
 * `setupDatabase()` only creates missing tables — it never alters existing
 * ones — so deployments that predate these columns need an explicit ALTER.
 */
const OUTCOME_COLUMNS: ReadonlyArray<{ readonly name: string; readonly ddl: string }> = [
  { name: "reason_code", ddl: "reason_code TEXT" },
  { name: "detail", ddl: "detail TEXT" },
  { name: "attempts", ddl: "attempts INTEGER NOT NULL DEFAULT 0" },
];

/** Adds any missing outcome columns; returns the names added (idempotent). */
export function addMissingProcessedFactsColumnsSqlite(db: Sqlite.Database): string[] {
  const tableExists = db
    .prepare<
      [],
      { name: string }
    >("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'processed_facts'")
    .get();
  if (!tableExists) return [];

  const existing = new Set(
    db
      .prepare<[], { name: string }>("PRAGMA table_info(processed_facts)")
      .all()
      .map((c) => c.name)
  );
  const added: string[] = [];
  for (const column of OUTCOME_COLUMNS) {
    if (!existing.has(column.name)) {
      db.exec(`ALTER TABLE processed_facts ADD COLUMN ${column.ddl}`);
      added.push(column.name);
    }
  }
  return added;
}

/**
 * Backend-dispatching wrapper used by `setupAllDatabases()`. No-ops for the
 * in-memory test backend (fresh tables always match the current schema).
 */
export async function migrateProcessedFactsColumns(): Promise<void> {
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  if (
    dbType === "sqlite" &&
    globalServiceRegistry.has(SEC_DB_FOLDER) &&
    globalServiceRegistry.has(SEC_DB_NAME)
  ) {
    addMissingProcessedFactsColumnsSqlite(getDb());
    return;
  }

  if (dbType === "postgres") {
    const pool = getPgPool();
    for (const column of OUTCOME_COLUMNS) {
      await pool.query(`ALTER TABLE processed_facts ADD COLUMN IF NOT EXISTS ${column.ddl}`);
    }
  }
}
