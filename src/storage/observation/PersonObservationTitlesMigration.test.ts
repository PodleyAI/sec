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
import { migratePersonObservationTitles } from "./PersonObservationTitlesMigration";
import { PersonObservationRepo } from "./PersonObservationRepo";

const TEST_DB_NAME = "person_obs_titles_migration_test";

describe("migratePersonObservationTitles (sqlite)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    tmpDir = mkdtempSync(join(tmpdir(), "sec-person-obs-titles-migration-"));
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

  it("adds titles column and backfills from legacy title", async () => {
    const db = getDb();
    db.exec(
      `CREATE TABLE person_observations (
        observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_number TEXT NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        observation_index INTEGER NOT NULL,
        title TEXT NULL,
        created_at TEXT NOT NULL
      )`
    );
    const insert = db.prepare(
      `INSERT INTO person_observations (accession_number, extractor_id, extractor_version, observation_index, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insert.run("0001-25-000001", "D", "1.0.0", 0, "CEO", "2026-05-22T00:00:00.000Z");
    insert.run("0001-25-000001", "D", "1.0.0", 1, null, "2026-05-22T00:00:00.000Z");
    insert.run("0001-25-000001", "D", "1.0.0", 2, "", "2026-05-22T00:00:00.000Z");

    await migratePersonObservationTitles();

    const columns = db
      .prepare<[], { name: string }>(`PRAGMA table_info(person_observations)`)
      .all();
    expect(columns.some((c) => c.name === "titles")).toBe(true);

    const rows = db
      .prepare<
        [],
        { observation_index: number; title: string | null; titles: string | null }
      >(
        `SELECT observation_index, title, titles FROM person_observations ORDER BY observation_index`
      )
      .all();
    // Non-null non-empty backfills to json_array(title).
    expect(rows[0].titles).not.toBeNull();
    const extracted = db
      .prepare<
        [],
        { first_title: string | null }
      >(
        `SELECT JSON_EXTRACT(titles, '$[0]') as first_title FROM person_observations WHERE observation_index = 0`
      )
      .get();
    expect(extracted?.first_title).toBe("CEO");
    // Null preserved.
    expect(rows[1].titles).toBeNull();
    // Empty string preserved as null.
    expect(rows[2].titles).toBeNull();
  });

  it("is idempotent: running the migration twice does not re-wrap already-migrated rows", async () => {
    const db = getDb();
    db.exec(
      `CREATE TABLE person_observations (
        observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_number TEXT NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        observation_index INTEGER NOT NULL,
        title TEXT NULL,
        created_at TEXT NOT NULL
      )`
    );
    db.prepare(
      `INSERT INTO person_observations (accession_number, extractor_id, extractor_version, observation_index, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("0001-25-000001", "D", "1.0.0", 0, "CEO", "2026-05-22T00:00:00.000Z");

    await migratePersonObservationTitles();
    const firstTitles = db
      .prepare<[], { titles: string | null }>(`SELECT titles FROM person_observations LIMIT 1`)
      .get()?.titles;

    await migratePersonObservationTitles();
    const secondTitles = db
      .prepare<[], { titles: string | null }>(`SELECT titles FROM person_observations LIMIT 1`)
      .get()?.titles;

    expect(secondTitles).toBe(firstTitles);
    // Sanity: single element, not doubly wrapped.
    const extracted = db
      .prepare<
        [],
        { first: string | null; second: string | null }
      >(
        `SELECT JSON_EXTRACT(titles, '$[0]') as first, JSON_EXTRACT(titles, '$[1]') as second FROM person_observations LIMIT 1`
      )
      .get();
    expect(extracted?.first).toBe("CEO");
    expect(extracted?.second).toBeNull();
  });

  it("is a no-op when the table does not exist yet", async () => {
    // Fresh DB: no table, no error.
    await migratePersonObservationTitles();
    const db = getDb();
    const remaining = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='person_observations'`)
      .get();
    expect(remaining).toBeUndefined();
  });

  it("PersonObservationRepo.upsertByNaturalKey succeeds with titles after migration", async () => {
    // Start with a legacy shape (title column, no titles), run the full
    // setup, then verify the repo layer can write titles arrays end to end.
    const db = getDb();
    db.exec(
      `CREATE TABLE person_observations (
        observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_number TEXT NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        observation_index INTEGER NOT NULL,
        source_filing_issuer_cik INTEGER NULL,
        cik INTEGER NULL,
        first_name TEXT NULL,
        middle_name TEXT NULL,
        last_name TEXT NULL,
        suffix TEXT NULL,
        normalized_first TEXT NULL,
        normalized_middle TEXT NULL,
        normalized_last TEXT NULL,
        normalized_suffix TEXT NULL,
        title TEXT NULL,
        relationship TEXT NULL,
        birth_year INTEGER NULL,
        bio TEXT NULL,
        raw_address_id TEXT NULL,
        raw_phone_id TEXT NULL,
        source_context TEXT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (accession_number, extractor_id, observation_index)
      )`
    );

    // Runs the migration then setupDatabase() on the current schema (both no-ops
    // where already applied), plus every other repo; end result matches production.
    await setupAllDatabases();

    const repo = new PersonObservationRepo();
    const row = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000042",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "Smith",
      normalized_last: "smith",
      titles: ["CEO"],
      created_at: "2026-05-22T00:00:00.000Z",
    });
    expect(row.titles).toEqual(["CEO"]);

    const readBack = await repo.getById(row.observation_id);
    expect(readBack?.titles).toEqual(["CEO"]);
  });
});
