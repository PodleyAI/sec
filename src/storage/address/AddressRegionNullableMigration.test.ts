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

/**
 * Column-tuple signature (e.g. `"(city)"`) of each user-defined index on
 * `addresses`, sorted so two equivalent index sets compare equal regardless of
 * index name or creation order. Auto-indexes (backing PRIMARY KEY / UNIQUE
 * constraints) carry `sql IS NULL` and are excluded, mirroring the migration's
 * own use of `sql IS NOT NULL` to decide which indexes it must recreate.
 */
function readAddressIndexColumnTuples(): string[] {
  return getDb()
    .prepare<
      [],
      { name: string; sql: string }
    >(`SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='addresses' AND sql IS NOT NULL`)
    .all()
    .map(({ sql }) => {
      const match = sql.match(/\(([^)]+)\)/);
      if (!match) throw new Error(`unexpected index SQL: ${sql}`);
      return `(${match[1]
        .split(",")
        .map((c) => c.trim().replace(/`/g, ""))
        .join(", ")})`;
    })
    .sort();
}

/**
 * The exact user-index shape a fresh `setupAllDatabases()` produces on the
 * `addresses` table — captured once in an isolated scratch DB and reused by the
 * migrated-shape assertions below. Comparing the exact tuple set (rather than a
 * threshold like `length > 0`) is what catches a silent unindexed rebuild.
 */
let cachedFreshAddressIndexColumns: readonly string[] | null = null;
async function computeFreshAddressIndexColumns(): Promise<readonly string[]> {
  if (cachedFreshAddressIndexColumns) return cachedFreshAddressIndexColumns;
  const scratch = mkdtempSync(join(tmpdir(), "sec-fresh-address-shape-"));
  try {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, scratch);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, "fresh_addresses_shape");
    DefaultDI();
    await setupAllDatabases();
    const tuples = readAddressIndexColumnTuples();
    // Guard the guard: if a future refactor drops every user-defined index on
    // `addresses`, the assertions below would degenerate to comparing empty
    // arrays. Fail loudly here instead.
    expect(tuples.length).toBeGreaterThan(0);
    cachedFreshAddressIndexColumns = tuples;
    return tuples;
  } finally {
    closeDb();
    rmSync(scratch, { recursive: true, force: true });
    resetDependencyInjectionsForTesting();
  }
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
    const expectedIndexColumns = await computeFreshAddressIndexColumns();
    // The helper closes the DB and clears DI; re-establish the per-test state.
    closeDb();
    resetDependencyInjectionsForTesting();
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, TEST_DB_NAME);

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

    // The rebuild must land on the exact index set a fresh DB has — a threshold
    // like "> 0" would still pass if half the indexes were silently dropped by
    // a future ALTER path.
    expect(readAddressIndexColumnTuples()).toEqual(expectedIndexColumns);
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

  it("recovers from an interrupt between RENAME and INSERT", async () => {
    const expectedIndexColumns = await computeFreshAddressIndexColumns();
    closeDb();
    resetDependencyInjectionsForTesting();
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, TEST_DB_NAME);

    const db = getDb();
    db.exec(LEGACY_DDL);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_addresses_city ON addresses (city)`);
    const insert = db.prepare(
      `INSERT INTO addresses
         (address_hash_id, street1, street2, street3, city, state_or_country, country_code, zip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run("hash-a", "1 First St", null, null, "NEW YORK", "NY", "US", "10001");
    insert.run("hash-b", "2 Second St", null, null, "BOSTON", "MA", "US", "02116");

    DefaultDI();

    // Simulate the exact stranded state the finding describes: a crash after
    // the rename + fresh-empty rebuild but before INSERT ran. Rename the legacy
    // table aside, drop its indexes (so setupDatabase's `CREATE INDEX IF NOT
    // EXISTS` actually runs), then let the repo recreate an empty `addresses`
    // at the current (nullable) schema.
    db.exec(`ALTER TABLE addresses RENAME TO addresses__legacy_region`);
    const strandedIndexes = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='addresses__legacy_region' AND sql IS NOT NULL`)
      .all();
    for (const { name } of strandedIndexes) {
      db.exec(`DROP INDEX IF EXISTS \`${name}\``);
    }
    await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).setupDatabase();

    // Sanity: this is the exact stranded shape — empty `addresses`, all rows
    // in the legacy table, no way to reach them through the normal repo.
    const preRows = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM addresses`)
      .get();
    expect(preRows?.n).toBe(0);
    const preLegacyRows = db
      .prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM addresses__legacy_region`)
      .get();
    expect(preLegacyRows?.n).toBe(2);

    // Booting into a normal setup pass must recover every stranded row rather
    // than silently accepting the fresh-empty `addresses` shape.
    await setupAllDatabases();

    const rows = db
      .prepare<
        [],
        { address_hash_id: string; city: string; state_or_country: string | null }
      >(`SELECT address_hash_id, city, state_or_country FROM addresses ORDER BY address_hash_id`)
      .all();
    expect(rows).toEqual([
      { address_hash_id: "hash-a", city: "NEW YORK", state_or_country: "NY" },
      { address_hash_id: "hash-b", city: "BOSTON", state_or_country: "MA" },
    ]);
    expect(regionColumnIsNullable()).toBe(true);
    expect(readAddressIndexColumnTuples()).toEqual(expectedIndexColumns);
    const leftover = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='addresses__legacy_region'`)
      .get();
    expect(leftover).toBeUndefined();
  });

  it("rolls back a failed migration attempt", async () => {
    const db = getDb();
    db.exec(LEGACY_DDL);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_addresses_city ON addresses (city)`);
    const insert = db.prepare(
      `INSERT INTO addresses
         (address_hash_id, street1, street2, street3, city, state_or_country, country_code, zip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insert.run("hash-x", "1 First St", null, null, "NEW YORK", "NY", "US", "10001");
    insert.run("hash-y", "2 Second St", null, null, "BOSTON", "MA", "US", "02116");

    DefaultDI();

    // Force the setupDatabase() inside the migration's rebuild to throw. The
    // second call (post-migration, from the setupAllDatabases fan-out) is
    // never reached because the migration itself rejects and cascades out.
    const realRepo = globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN);
    let setupCalls = 0;
    const proxyRepo = new Proxy(realRepo, {
      get(target, prop, receiver) {
        if (prop === "setupDatabase") {
          return async () => {
            setupCalls += 1;
            if (setupCalls === 1) {
              throw new Error("simulated setup failure");
            }
            return Reflect.get(target, prop, receiver).call(target);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    globalServiceRegistry.registerInstance(ADDRESS_REPOSITORY_TOKEN, proxyRepo);

    await expect(setupAllDatabases()).rejects.toThrow("simulated setup failure");

    // Every seeded row must still be reachable on the original legacy shape,
    // and the scratch legacy table must not exist — either would mean the
    // partial rebuild leaked past the rollback.
    const columns = db
      .prepare<[], { name: string; notnull: number }>(`PRAGMA table_info(addresses)`)
      .all();
    const region = columns.find((c) => c.name === "state_or_country");
    expect(region).toBeDefined();
    expect(region!.notnull).toBe(1);

    const rows = db
      .prepare<
        [],
        { address_hash_id: string; city: string; state_or_country: string | null }
      >(`SELECT address_hash_id, city, state_or_country FROM addresses ORDER BY address_hash_id`)
      .all();
    expect(rows).toEqual([
      { address_hash_id: "hash-x", city: "NEW YORK", state_or_country: "NY" },
      { address_hash_id: "hash-y", city: "BOSTON", state_or_country: "MA" },
    ]);

    const leftover = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='addresses__legacy_region'`)
      .get();
    expect(leftover).toBeUndefined();
  });
});
