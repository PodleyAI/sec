/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Sqlite } from "workglow";
import { addMissingProcessedFactsColumnsSqlite } from "./migrateProcessedFactsColumns";

async function makeLegacyDb(): Promise<Sqlite.Database> {
  if (typeof (Sqlite as { init?: () => Promise<void> }).init === "function") {
    await (Sqlite as unknown as { init: () => Promise<void> }).init();
  }
  const db = new Sqlite.Database(":memory:");
  db.exec(
    `CREATE TABLE processed_facts (
      cik INTEGER PRIMARY KEY,
      last_processed TEXT NOT NULL,
      success INTEGER NOT NULL
    )`
  );
  db.exec(`INSERT INTO processed_facts VALUES (1, '2026-06-01', 0)`);
  return db;
}

describe("addMissingProcessedFactsColumnsSqlite", () => {
  it("adds the outcome columns to a legacy table and is idempotent", async () => {
    const db = await makeLegacyDb();

    const added = addMissingProcessedFactsColumnsSqlite(db);
    expect(added).toEqual(["reason_code", "detail", "attempts"]);
    expect(addMissingProcessedFactsColumnsSqlite(db)).toEqual([]);

    const row = db
      .prepare<
        [],
        { attempts: number; reason_code: string | null }
      >("SELECT attempts, reason_code FROM processed_facts WHERE cik = 1")
      .get();
    expect(row?.attempts).toBe(0);
    expect(row?.reason_code).toBeNull();
  });

  it("no-ops when the table does not exist yet", async () => {
    if (typeof (Sqlite as { init?: () => Promise<void> }).init === "function") {
      await (Sqlite as unknown as { init: () => Promise<void> }).init();
    }
    const db = new Sqlite.Database(":memory:");
    expect(addMissingProcessedFactsColumnsSqlite(db)).toEqual([]);
  });
});
