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
import { migrateLegacyPersonObservationsTitles } from "./PersonObservationTitleMigration";

const TEST_DB_NAME = "person_obs_titles_migration_test";

const LEGACY_TABLE_DDL = `
  CREATE TABLE person_observations (
    observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
    accession_number TEXT NOT NULL,
    extractor_id TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    observation_index INTEGER NOT NULL,
    title TEXT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (accession_number, extractor_id, observation_index)
  )
`;

interface ColumnInfo {
  readonly name: string;
}

interface TitleRow {
  readonly observation_index: number;
  readonly titles: string | null;
}

function columnNames(): ReadonlyArray<string> {
  const db = getDb();
  return db
    .prepare<[], ColumnInfo>(`PRAGMA table_info(person_observations)`)
    .all()
    .map((c) => c.name);
}

describe("migrateLegacyPersonObservationsTitles (sqlite)", () => {
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
    // Same fix-up dance as Form8KEventLegacyMigration.test: pin SEC_DB_TYPE
    // to a sentinel so later tests in this Bun process fall through both
    // dispatch branches back to the in-memory backend.
    globalServiceRegistry.registerInstance(
      SEC_DB_TYPE,
      "memory" as unknown as "sqlite" | "postgres"
    );
    resetDependencyInjectionsForTesting();
  });

  it("rewrites a legacy `title` column into a JSON `titles` array", async () => {
    const db = getDb();
    db.exec(LEGACY_TABLE_DDL);
    const insert = db.prepare(
      `INSERT INTO person_observations (accession_number, extractor_id, extractor_version, observation_index, title, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    );
    insert.run("0001-24-000001", "S-1", "1.0.0", 0, "CEO", "2026-01-15T00:00:00Z");
    insert.run(
      "0001-24-000001",
      "S-1",
      "1.0.0",
      1,
      "Chief Executive Officer and Director",
      "2026-01-15T00:00:00Z"
    );
    insert.run("0001-24-000001", "S-1", "1.0.0", 2, null, "2026-01-15T00:00:00Z");

    await migrateLegacyPersonObservationsTitles();

    const cols = columnNames();
    expect(cols).toContain("titles");
    expect(cols).not.toContain("title");

    const rows = db
      .prepare<
        [],
        TitleRow
      >(`SELECT observation_index, titles FROM person_observations ORDER BY observation_index`)
      .all();
    expect(rows).toHaveLength(3);
    expect(JSON.parse(rows[0]!.titles ?? "null")).toEqual(["CEO"]);
    expect(JSON.parse(rows[1]!.titles ?? "null")).toEqual(["Chief Executive Officer and Director"]);
    expect(rows[2]!.titles).toBeNull();
  });

  it("is a no-op when the table is already on the new shape", async () => {
    const db = getDb();
    db.exec(
      `CREATE TABLE person_observations (
        observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_number TEXT NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        observation_index INTEGER NOT NULL,
        titles TEXT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (accession_number, extractor_id, observation_index)
      )`
    );
    db.prepare(
      `INSERT INTO person_observations (accession_number, extractor_id, extractor_version, observation_index, titles, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run("0001-24-000002", "S-1", "1.0.0", 0, '["CEO"]', "2026-01-15T00:00:00Z");

    await migrateLegacyPersonObservationsTitles();

    const cols = columnNames();
    expect(cols).toContain("titles");
    expect(cols).not.toContain("title");

    const rows = db
      .prepare<
        [],
        TitleRow
      >(`SELECT observation_index, titles FROM person_observations ORDER BY observation_index`)
      .all();
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.titles ?? "null")).toEqual(["CEO"]);
  });

  it("is a no-op when the table does not exist yet", async () => {
    // Fresh DB: no table, no error, and no table conjured out of thin air.
    await migrateLegacyPersonObservationsTitles();
    const db = getDb();
    const remaining = db
      .prepare<
        [],
        { name: string }
      >(`SELECT name FROM sqlite_master WHERE type='table' AND name='person_observations'`)
      .get();
    expect(remaining).toBeUndefined();
  });

  it("reconciles a half-migrated table that carries both `title` and `titles`", async () => {
    const db = getDb();
    db.exec(
      `CREATE TABLE person_observations (
        observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
        accession_number TEXT NOT NULL,
        extractor_id TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        observation_index INTEGER NOT NULL,
        title TEXT NULL,
        titles TEXT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (accession_number, extractor_id, observation_index)
      )`
    );
    db.prepare(
      `INSERT INTO person_observations (accession_number, extractor_id, extractor_version, observation_index, title, titles, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("0001-24-000003", "S-1", "1.0.0", 0, "CEO", null, "2026-01-15T00:00:00Z");
    db.prepare(
      `INSERT INTO person_observations (accession_number, extractor_id, extractor_version, observation_index, title, titles, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("0001-24-000003", "S-1", "1.0.0", 1, "Old", '["New"]', "2026-01-15T00:00:00Z");

    await migrateLegacyPersonObservationsTitles();

    const cols = columnNames();
    expect(cols).toContain("titles");
    expect(cols).not.toContain("title");

    const rows = db
      .prepare<
        [],
        TitleRow
      >(`SELECT observation_index, titles FROM person_observations ORDER BY observation_index`)
      .all();
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0]!.titles ?? "null")).toEqual(["CEO"]);
    expect(JSON.parse(rows[1]!.titles ?? "null")).toEqual(["New"]);
  });
});
