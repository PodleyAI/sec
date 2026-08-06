/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry, Sqlite } from "workglow";
import { DefaultDI } from "../../config/DefaultDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { closeDb, getDb } from "../../util/db";
import { ADDRESS_REPOSITORY_TOKEN } from "./AddressSchema";

const TEST_DB_NAME = "address_region_nullable_migration_test";

/** The pre-migration shape: `state_or_country` declared NOT NULL. */
const LEGACY_DDL = `
  CREATE TABLE addresses (
    address_hash_id TEXT NOT NULL,
    street1 TEXT NOT NULL,
    street2 TEXT NULL,
    street3 TEXT NULL,
    city TEXT NOT NULL,
    state_or_country TEXT NOT NULL,
    country_code TEXT NOT NULL,
    zip TEXT NULL,
    PRIMARY KEY (address_hash_id)
  )`;

/** The post-migration shape: `state_or_country` nullable. */
const REBUILT_DDL = LEGACY_DDL.replace("state_or_country TEXT NOT NULL", "state_or_country TEXT");

function insertLegacyRow(table: string, hashId: string, city: string, region: string | null): void {
  getDb()
    .prepare(
      `INSERT INTO ${table}
         (address_hash_id, street1, street2, street3, city, state_or_country, country_code, zip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(hashId, "123 Main St", null, null, city, region, "US", "10001");
}

function addressHashIds(): string[] {
  return getDb()
    .prepare<[], { address_hash_id: string }>(
      `SELECT address_hash_id FROM addresses ORDER BY address_hash_id`
    )
    .all()
    .map((r) => r.address_hash_id);
}

function tableExists(name: string): boolean {
  const row = getDb()
    .prepare<
      [],
      { name: string }
    >(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`)
    .get();
  return Boolean(row);
}

function regionColumnIsNullable(): boolean {
  const columns = getDb()
    .prepare<[], { name: string; notnull: number }>(`PRAGMA table_info(addresses)`)
    .all();
  const region = columns.find((c) => c.name === "state_or_country");
  expect(region).toBeDefined();
  return region!.notnull === 0;
}

describe("migrateAddressRegionNullable (sqlite)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    tmpDir = mkdtempSync(join(tmpdir(), "sec-address-region-migration-"));
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, TEST_DB_NAME);
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
    resetDependencyInjectionsForTesting();
  });

  it("relaxes the NOT NULL region on a legacy table and preserves every row", async () => {
    const db = getDb();
    db.exec(LEGACY_DDL);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_addresses_city ON addresses (city)`);
    db.prepare(
      `INSERT INTO addresses
         (address_hash_id, street1, street2, street3, city, state_or_country, country_code, zip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("hash-1", "123 Main St", null, null, "NEW YORK", "NY", "US", "10001");

    DefaultDI();
    await setupAllDatabases();

    expect(regionColumnIsNullable()).toBe(true);

    const rows = db
      .prepare<
        [],
        { address_hash_id: string; city: string; state_or_country: string | null }
      >(`SELECT address_hash_id, city, state_or_country FROM addresses`)
      .all();
    expect(rows).toEqual([{ address_hash_id: "hash-1", city: "NEW YORK", state_or_country: "NY" }]);

    // The rebuild must not leave the table unindexed, and the scratch table is gone.
    const indexes = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='addresses' AND sql IS NOT NULL`)
      .all();
    expect(indexes.length).toBeGreaterThan(0);
    const leftover = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='addresses__legacy_region'`)
      .get();
    expect(leftover).toBeUndefined();

    // A US address with no state now stores rather than failing the constraint.
    await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).put({
      address_hash_id: "hash-2",
      street1: "500 Boylston St",
      street2: null,
      street3: null,
      city: "BOSTON",
      state_or_country: null,
      country_code: "US",
      zip: null,
    });
    const stored = await globalServiceRegistry
      .get(ADDRESS_REPOSITORY_TOKEN)
      .get({ address_hash_id: "hash-2" });
    expect(stored?.state_or_country).toBeNull();
  });

  it("an interrupted copy leaves every row recoverable", async () => {
    const db = getDb();
    db.exec(LEGACY_DDL);
    insertLegacyRow("addresses", "hash-1", "NEW YORK", "NY");
    insertLegacyRow("addresses", "hash-2", "BOSTON", "MA");

    DefaultDI();

    // Simulate the copy failing mid-rebuild (disk full / SIGINT / OOM). Every
    // other statement runs for real, so the rest of the rebuild is genuine.
    const realExec = db.exec.bind(db);
    const spy = vi.spyOn(db, "exec").mockImplementation((sql: string, ...rest: unknown[]) => {
      if (sql.trimStart().startsWith("INSERT INTO addresses")) {
        throw new Error("database or disk is full");
      }
      return (realExec as (s: string, ...r: unknown[]) => unknown)(sql, ...rest);
    });

    await expect(setupAllDatabases()).rejects.toThrow(/database or disk is full/);

    spy.mockRestore();

    // The rollback must have put the table back exactly as it was: still the
    // legacy NOT NULL shape, with both rows present.
    expect(regionColumnIsNullable()).toBe(false);
    expect(addressHashIds()).toEqual(["hash-1", "hash-2"]);
    expect(tableExists("addresses__legacy_region")).toBe(false);

    // And a re-run completes the rebuild, still with both rows.
    await setupAllDatabases();
    expect(regionColumnIsNullable()).toBe(true);
    expect(addressHashIds()).toEqual(["hash-1", "hash-2"]);
    expect(tableExists("addresses__legacy_region")).toBe(false);
  });

  it("resumes a rebuild stranded by an older build", async () => {
    const db = getDb();
    // Hand-construct the state an older, non-transactional build could leave:
    // rows stranded in the legacy table beside an empty new-shape `addresses`.
    db.exec(LEGACY_DDL);
    insertLegacyRow("addresses", "hash-1", "NEW YORK", "NY");
    insertLegacyRow("addresses", "hash-2", "BOSTON", "MA");
    db.exec(`ALTER TABLE addresses RENAME TO addresses__legacy_region`);
    db.exec(REBUILT_DDL);

    DefaultDI();
    await setupAllDatabases();

    expect(regionColumnIsNullable()).toBe(true);
    expect(addressHashIds()).toEqual(["hash-1", "hash-2"]);
    expect(tableExists("addresses__legacy_region")).toBe(false);
  });

  it("resumes when the copy finished but the legacy DROP did not", async () => {
    const db = getDb();
    // The old build's LAST statement was `DROP TABLE addresses__legacy_region`,
    // so a crash immediately before it left the rows in BOTH tables. The old
    // code then reported success forever after (it probed a nullable column and
    // returned early), so this state can have been serving traffic for months.
    // A blind copy back would fail the primary key and roll back, making
    // `db setup` fail on every run from here on.
    db.exec(LEGACY_DDL);
    insertLegacyRow("addresses", "hash-1", "NEW YORK", "NY");
    insertLegacyRow("addresses", "hash-2", "BOSTON", "MA");
    db.exec(`ALTER TABLE addresses RENAME TO addresses__legacy_region`);
    db.exec(REBUILT_DDL);
    insertLegacyRow("addresses", "hash-1", "NEW YORK", "NY");
    insertLegacyRow("addresses", "hash-2", "BOSTON", "MA");

    DefaultDI();
    await setupAllDatabases();

    expect(regionColumnIsNullable()).toBe(true);
    expect(addressHashIds()).toEqual(["hash-1", "hash-2"]);
    expect(tableExists("addresses__legacy_region")).toBe(false);
  });

  it("keeps rows written after an older build reported success", async () => {
    const db = getDb();
    // Same stranded state, but the database went on being written to: the live
    // table holds rows the legacy snapshot has never seen. Dropping the live
    // table to make room for the copy would discard exactly those.
    db.exec(LEGACY_DDL);
    insertLegacyRow("addresses", "hash-1", "NEW YORK", "NY");
    db.exec(`ALTER TABLE addresses RENAME TO addresses__legacy_region`);
    db.exec(REBUILT_DDL);
    insertLegacyRow("addresses", "hash-1", "NEW YORK", "NY");
    insertLegacyRow("addresses", "hash-9", "SEATTLE", null);

    DefaultDI();
    await setupAllDatabases();

    expect(regionColumnIsNullable()).toBe(true);
    expect(addressHashIds()).toEqual(["hash-1", "hash-9"]);
    expect(tableExists("addresses__legacy_region")).toBe(false);
    // The live row won its primary-key collision — it is the current state,
    // while the legacy table is a pre-rebuild snapshot.
    const kept = db
      .prepare<[], { city: string }>(`SELECT city FROM addresses WHERE address_hash_id = 'hash-9'`)
      .get();
    expect(kept?.city).toBe("SEATTLE");
  });

  it("refuses rather than dropping a populated legacy-shaped live table", async () => {
    const db = getDb();
    db.exec(LEGACY_DDL);
    insertLegacyRow("addresses", "hash-1", "NEW YORK", "NY");
    db.exec(`ALTER TABLE addresses RENAME TO addresses__legacy_region`);
    // A second NOT NULL table, populated: two copies and no way to tell which
    // rows are current. Tidying up the shape by dropping rows is the failure
    // this whole rebuild exists to prevent.
    db.exec(LEGACY_DDL);
    insertLegacyRow("addresses", "hash-7", "AUSTIN", "TX");

    DefaultDI();
    await expect(setupAllDatabases()).rejects.toThrow(/two populated copies/);

    expect(addressHashIds()).toEqual(["hash-7"]);
    expect(tableExists("addresses__legacy_region")).toBe(true);
  });

  it("refuses to destroy a stranded legacy table when the live table is unusable", async () => {
    const db = getDb();
    // Crash between the rename and the recreate: no `addresses` at all, rows
    // only in the legacy table. The plain `!tableExists` early return would
    // skip the migration and let the caller create an empty table over it.
    db.exec(LEGACY_DDL);
    insertLegacyRow("addresses", "hash-1", "NEW YORK", "NY");
    insertLegacyRow("addresses", "hash-2", "BOSTON", "MA");
    db.exec(`ALTER TABLE addresses RENAME TO addresses__legacy_region`);

    DefaultDI();
    await setupAllDatabases();

    expect(regionColumnIsNullable()).toBe(true);
    expect(addressHashIds()).toEqual(["hash-1", "hash-2"]);
    expect(tableExists("addresses__legacy_region")).toBe(false);
  });

  it("is a no-op on a fresh database", async () => {
    DefaultDI();
    await setupAllDatabases();
    expect(regionColumnIsNullable()).toBe(true);
  });

  it("is a no-op when the column is already nullable", async () => {
    DefaultDI();
    await setupAllDatabases();
    await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).put({
      address_hash_id: "hash-3",
      street1: "1 Infinite Loop",
      street2: null,
      street3: null,
      city: "CUPERTINO",
      state_or_country: "CA",
      country_code: "US",
      zip: "95014",
    });

    // Second setup pass: the migration must not touch an already-migrated table.
    await setupAllDatabases();

    expect(regionColumnIsNullable()).toBe(true);
    const stored = await globalServiceRegistry
      .get(ADDRESS_REPOSITORY_TOKEN)
      .get({ address_hash_id: "hash-3" });
    expect(stored?.city).toBe("CUPERTINO");
  });
});
