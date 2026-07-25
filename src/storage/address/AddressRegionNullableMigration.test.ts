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
