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
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { closeDb, getDb } from "../../util/db";
import { migrateSpacLoiColumns } from "./SpacLoiColumnsMigration";
import { SpacRepo } from "./SpacRepo";
import type { Spac } from "./SpacSchema";

const TEST_DB_NAME = "spac_loi_migration_test";

const SPAC_LOI_TABLES = ["spac", "spac_deal", "spac_history"] as const;

function createLegacySpacTables(db: Sqlite.Database): void {
  db.exec(
    `CREATE TABLE spac (
      cik INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`
  );
  db.exec(
    `CREATE TABLE spac_deal (
      cik INTEGER NOT NULL,
      deal_index INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (cik, deal_index)
    )`
  );
  db.exec(
    `CREATE TABLE spac_history (
      cik INTEGER NOT NULL,
      valid_from TEXT NOT NULL,
      change_source TEXT NOT NULL,
      change_date TEXT NOT NULL,
      PRIMARY KEY (cik, valid_from)
    )`
  );
}

describe("migrateSpacLoiColumns (sqlite)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    tmpDir = mkdtempSync(join(tmpdir(), "sec-spac-loi-migration-"));
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, TEST_DB_NAME);
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
    // ServiceRegistry has no unregister API; pin to a non-dispatchable sentinel
    // so any subsequent test in the same Bun process falls back to in-memory.
    globalServiceRegistry.registerInstance(
      SEC_DB_TYPE,
      "memory" as unknown as "sqlite" | "postgres"
    );
    resetDependencyInjectionsForTesting();
  });

  it("adds loi_date column to spac, spac_deal, and spac_history", async () => {
    const db = getDb();
    createLegacySpacTables(db);

    await migrateSpacLoiColumns();

    for (const table of SPAC_LOI_TABLES) {
      const columns = db
        .prepare<[], { name: string }>(`PRAGMA table_info(\`${table}\`)`)
        .all();
      expect(
        columns.some((c) => c.name === "loi_date"),
        `${table} missing loi_date after migration`
      ).toBe(true);
    }
  });

  it("is idempotent: running twice does not double-add", async () => {
    const db = getDb();
    createLegacySpacTables(db);

    await migrateSpacLoiColumns();
    await migrateSpacLoiColumns();

    for (const table of SPAC_LOI_TABLES) {
      const columns = db
        .prepare<[], { name: string }>(`PRAGMA table_info(\`${table}\`)`)
        .all();
      const loiCols = columns.filter((c) => c.name === "loi_date");
      expect(loiCols).toHaveLength(1);
    }
  });

  it("is a no-op when the tables do not exist yet", async () => {
    await migrateSpacLoiColumns();
    const db = getDb();
    for (const table of SPAC_LOI_TABLES) {
      const row = db
        .prepare<
          [],
          { name: string }
        >(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(table);
      expect(row).toBeUndefined();
    }
  });

  it("SpacRepo.saveSpac succeeds with status='loi' + loi_date after migration", async () => {
    const db = getDb();
    createLegacySpacTables(db);

    await setupAllDatabases();

    const repo = new SpacRepo();
    const row: Spac = {
      cik: 9999999,
      current_cik: null,
      status: "loi",
      spac_name: null,
      target_name: null,
      surviving_name: null,
      current_name: null,
      spac_sic: null,
      post_merger_sic: null,
      current_sic: null,
      spac_tickers: null,
      post_merger_tickers: null,
      current_tickers: null,
      ipo_proceeds: null,
      trust_amount: null,
      pipe_amount: null,
      total_redemption_amount: null,
      focus: null,
      focus_location: null,
      description: null,
      target_description: null,
      team: null,
      details: null,
      url_spac: null,
      url_sponsor: null,
      investorpres_url: null,
      investorpres_date: null,
      registration_date: null,
      ipo_date: null,
      unit_split_date: null,
      loi_date: "2026-01-15",
      definitive_agreement_date: null,
      proxy_date: null,
      vote_date: null,
      completed_date: null,
      failed_date: null,
      as_of: null,
      updated_at: "2026-05-22T00:00:00.000Z",
    };
    await repo.saveSpac(row);
    const readBack = await repo.getSpac(9999999);
    expect(readBack?.status).toBe("loi");
    expect(readBack?.loi_date).toBe("2026-01-15");
  });
});
