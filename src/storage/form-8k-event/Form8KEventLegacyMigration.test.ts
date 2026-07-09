/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, Sqlite } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { closeDb, getDb } from "../../util/db";
import { migrateLegacyForm8KEventsTable } from "./Form8KEventLegacyMigration";

const TEST_DB_NAME = "form8k_legacy_migration_test";

describe("migrateLegacyForm8KEventsTable (sqlite)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    tmpDir = mkdtempSync(join(tmpdir(), "sec-form8k-migration-"));
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, TEST_DB_NAME);
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
    // ServiceRegistry has no unregister API. Pin the tokens this test set to
    // sentinels that fail both `dbType === "sqlite"` and `dbType === "postgres"`
    // dispatch branches downstream so the in-memory test backend stays in
    // charge for any test that runs after us in the same Bun process.
    globalServiceRegistry.registerInstance(
      SEC_DB_TYPE,
      "memory" as unknown as "sqlite" | "postgres"
    );
    resetDependencyInjectionsForTesting();
  });

  it("drops a legacy form_8k_events table that lacks the event_id column", async () => {
    const db = getDb();
    db.exec(
      `CREATE TABLE form_8k_events (
        cik INTEGER NOT NULL,
        accession_number TEXT NOT NULL,
        item_code TEXT NOT NULL,
        item_description TEXT NULL,
        filing_date TEXT NOT NULL,
        report_date TEXT NULL,
        is_amendment INTEGER NOT NULL,
        PRIMARY KEY (cik, accession_number, item_code)
      )`
    );
    db.prepare(
      `INSERT INTO form_8k_events (cik, accession_number, item_code, filing_date, is_amendment) VALUES (?, ?, ?, ?, ?)`
    ).run(320193, "0001193125-24-000001", "2.02", "2024-01-15", 0);

    await migrateLegacyForm8KEventsTable();

    const remaining = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='form_8k_events'`)
      .get();
    expect(remaining).toBeUndefined();
  });

  it("is a no-op when the table already has the event_id column", async () => {
    const db = getDb();
    db.exec(
      `CREATE TABLE form_8k_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        cik INTEGER NOT NULL,
        accession_number TEXT NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        item_code TEXT NOT NULL,
        item_description TEXT NULL,
        filing_date TEXT NOT NULL,
        report_date TEXT NULL,
        is_amendment INTEGER NOT NULL
      )`
    );

    await migrateLegacyForm8KEventsTable();

    const remaining = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='form_8k_events'`)
      .get();
    expect(remaining).toBeDefined();
  });

  it("is a no-op when the table does not exist yet", async () => {
    // Fresh DB: no table, no error.
    await migrateLegacyForm8KEventsTable();
    const db = getDb();
    const remaining = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='form_8k_events'`)
      .get();
    expect(remaining).toBeUndefined();
  });
});
