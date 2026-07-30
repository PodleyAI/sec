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
import {
  SEC_DB_FOLDER,
  SEC_DB_NAME,
  SEC_DB_TYPE,
  SEC_PG_URL,
} from "../../config/tokens";
import { closeDb, getDb } from "../../util/db";
import { closePgPool, getPgPool } from "../../util/pg";
import { migrateLegacyPersonObservationTitles } from "./PersonObservationTitlesLegacyMigration";

const TEST_DB_NAME = "person_observation_titles_migration_test";

interface TitleRow {
  readonly observation_id: number;
  readonly title: string;
}

function createLegacyPersonObservationsTable(db: Sqlite.Database): void {
  // Pre-PR shape: the person_observations table carried a `titles` TEXT column
  // holding a JSON-encoded array of title strings.
  db.exec(
    `CREATE TABLE person_observations (
      observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      accession_number TEXT NOT NULL,
      extractor_id TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      observation_index INTEGER NOT NULL,
      titles TEXT NULL
    )`
  );
}

function createNewPersonObservationsTable(db: Sqlite.Database): void {
  // Post-PR shape: no `titles` column at all.
  db.exec(
    `CREATE TABLE person_observations (
      observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      accession_number TEXT NOT NULL,
      extractor_id TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      observation_index INTEGER NOT NULL
    )`
  );
}

function createTitlesTable(db: Sqlite.Database): void {
  db.exec(
    `CREATE TABLE person_observation_titles (
      observation_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      PRIMARY KEY (observation_id, title)
    )`
  );
}

function insertLegacyObservation(
  db: Sqlite.Database,
  observation_id: number,
  titles: string | null
): void {
  db.prepare(
    `INSERT INTO person_observations
     (observation_id, accession_number, extractor_id, extractor_version, observation_index, titles)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(observation_id, `acc-${observation_id}`, "S-1", "1.0.0", observation_id, titles);
}

function selectAllTitles(db: Sqlite.Database): TitleRow[] {
  return db
    .prepare<[], TitleRow>(
      `SELECT observation_id, title FROM person_observation_titles ORDER BY observation_id, title`
    )
    .all();
}

describe("migrateLegacyPersonObservationTitles (sqlite)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }
    tmpDir = mkdtempSync(join(tmpdir(), "sec-person-titles-migration-"));
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "sqlite");
    globalServiceRegistry.registerInstance(SEC_DB_FOLDER, tmpDir);
    globalServiceRegistry.registerInstance(SEC_DB_NAME, TEST_DB_NAME);
  });

  afterEach(() => {
    closeDb();
    rmSync(tmpDir, { recursive: true, force: true });
    resetDependencyInjectionsForTesting();
  });

  it("copies populated legacy titles arrays into per-title rows", async () => {
    const db = getDb();
    createLegacyPersonObservationsTable(db);
    createTitlesTable(db);
    insertLegacyObservation(db, 1, JSON.stringify(["Chief Executive Officer", "Director"]));
    insertLegacyObservation(db, 2, JSON.stringify(["President"]));
    insertLegacyObservation(
      db,
      3,
      JSON.stringify(["Founder", "  founder  ", "Chairman", ""])
    );

    await migrateLegacyPersonObservationTitles();

    expect(selectAllTitles(db)).toEqual([
      { observation_id: 1, title: "Chief Executive Officer" },
      { observation_id: 1, title: "Director" },
      { observation_id: 2, title: "President" },
      { observation_id: 3, title: "Chairman" },
      { observation_id: 3, title: "Founder" },
    ]);
  });

  it("is a no-op when every legacy row has null or empty titles", async () => {
    const db = getDb();
    createLegacyPersonObservationsTable(db);
    createTitlesTable(db);
    insertLegacyObservation(db, 1, null);
    insertLegacyObservation(db, 2, "[]");
    insertLegacyObservation(db, 3, "null");

    await migrateLegacyPersonObservationTitles();

    expect(selectAllTitles(db)).toEqual([]);
  });

  it("is a no-op on a fresh DB whose person_observations lacks a titles column", async () => {
    const db = getDb();
    createNewPersonObservationsTable(db);
    createTitlesTable(db);

    await expect(migrateLegacyPersonObservationTitles()).resolves.toBeUndefined();
    expect(selectAllTitles(db)).toEqual([]);
  });

  it("is idempotent — a second run inserts zero new rows", async () => {
    const db = getDb();
    createLegacyPersonObservationsTable(db);
    createTitlesTable(db);
    insertLegacyObservation(db, 1, JSON.stringify(["Chief Executive Officer", "Director"]));
    insertLegacyObservation(db, 2, JSON.stringify(["President"]));

    await migrateLegacyPersonObservationTitles();
    const afterFirst = selectAllTitles(db);
    await migrateLegacyPersonObservationTitles();
    const afterSecond = selectAllTitles(db);

    expect(afterFirst).toHaveLength(3);
    expect(afterSecond).toEqual(afterFirst);
  });

  it("preserves a pre-existing title row rather than overwriting it", async () => {
    const db = getDb();
    createLegacyPersonObservationsTable(db);
    createTitlesTable(db);
    // A prior write (perhaps a partial migration) already placed a row for
    // observation 1; the legacy `titles` array asserts the same title. The
    // migration must not treat the existing row as stale.
    db.prepare(
      `INSERT INTO person_observation_titles (observation_id, title) VALUES (?, ?)`
    ).run(1, "Chief Executive Officer");
    insertLegacyObservation(
      db,
      1,
      JSON.stringify(["Chief Executive Officer", "Director"])
    );

    await migrateLegacyPersonObservationTitles();

    expect(selectAllTitles(db)).toEqual([
      { observation_id: 1, title: "Chief Executive Officer" },
      { observation_id: 1, title: "Director" },
    ]);
  });

  it("an interrupt mid-run preserves prior chunks and a re-run finishes cleanly", async () => {
    const db = getDb();
    createLegacyPersonObservationsTable(db);
    createTitlesTable(db);
    // 10_001 rows — chunk 1 covers observation_ids 1..5000, chunk 2 covers
    // 5001..10_000, chunk 3 covers 10_001. We arrange for chunk 2's insert to
    // throw at observation_id 7500 so chunk 1 must survive independently and
    // chunk 3 must not have started.
    for (let i = 1; i <= 10_001; i += 1) {
      insertLegacyObservation(db, i, JSON.stringify([`Title ${i}`]));
    }

    const originalPrepare = db.prepare.bind(db);
    let interceptActive = true;
    (db as { prepare: unknown }).prepare = ((sql: string) => {
      const stmt = originalPrepare(sql);
      if (interceptActive && sql.includes("INSERT OR IGNORE INTO person_observation_titles")) {
        const originalRun = stmt.run.bind(stmt);
        stmt.run = (...params: unknown[]) => {
          if (params[0] === 7500) {
            throw new Error("simulated insert failure at observation_id 7500");
          }
          return originalRun(...(params as never[]));
        };
      }
      return stmt;
    }) as typeof db.prepare;

    await expect(migrateLegacyPersonObservationTitles()).rejects.toThrow(
      /simulated insert failure/
    );

    const count = db
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM person_observation_titles`)
      .get();
    expect(count?.c).toBe(5000);

    // Remove the intercept and re-run — should finish cleanly, no PK violation
    // (INSERT OR IGNORE elides chunk 1's already-committed pairs) and every
    // observation is now covered.
    interceptActive = false;
    await migrateLegacyPersonObservationTitles();

    const finalCount = db
      .prepare<[], { c: number }>(`SELECT COUNT(*) AS c FROM person_observation_titles`)
      .get();
    expect(finalCount?.c).toBe(10_001);
  });

  it("prior chunk is visible to a separate connection before the next chunk starts", async () => {
    const db = getDb();
    createLegacyPersonObservationsTable(db);
    createTitlesTable(db);
    for (let i = 1; i <= 10_001; i += 1) {
      insertLegacyObservation(db, i, JSON.stringify([`Title ${i}`]));
    }

    const dbPath = join(tmpDir, `${TEST_DB_NAME}.sqlite`);
    let captured: number | null = null;

    const originalPrepare = db.prepare.bind(db);
    (db as { prepare: unknown }).prepare = ((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes("INSERT OR IGNORE INTO person_observation_titles")) {
        const originalRun = stmt.run.bind(stmt);
        stmt.run = (...params: unknown[]) => {
          // First insert of chunk 2 — chunk 1 has just committed. A separate
          // connection must be able to observe the 5000 rows chunk 1 wrote.
          if (params[0] === 5001 && captured === null) {
            const second = new Sqlite.Database(dbPath);
            try {
              const row = second
                .prepare<[], { c: number }>(
                  `SELECT COUNT(*) AS c FROM person_observation_titles`
                )
                .get();
              captured = row?.c ?? 0;
            } finally {
              second.close();
            }
          }
          return originalRun(...(params as never[]));
        };
      }
      return stmt;
    }) as typeof db.prepare;

    await migrateLegacyPersonObservationTitles();

    expect(captured).toBe(5000);
  });
});

describe.skipIf(!process.env.SEC_PG_URL)(
  "migrateLegacyPersonObservationTitles (postgres)",
  () => {
    beforeEach(async () => {
      resetDependencyInjectionsForTesting();
      await closePgPool();
      globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      globalServiceRegistry.registerInstance(SEC_PG_URL, process.env.SEC_PG_URL!);

      const client = await getPgPool().connect();
      try {
        // Fresh test DB expected; drop any prior artefacts so the test is
        // reproducible even if a previous run aborted before cleanup.
        await client.query(`DROP TABLE IF EXISTS person_observation_titles`);
        await client.query(`DROP TABLE IF EXISTS person_observations`);
        await client.query(
          `CREATE TABLE person_observations (
             observation_id INTEGER PRIMARY KEY,
             titles TEXT NULL
           )`
        );
        await client.query(
          `CREATE TABLE person_observation_titles (
             observation_id INTEGER NOT NULL,
             title TEXT NOT NULL,
             PRIMARY KEY (observation_id, title)
           )`
        );
      } finally {
        client.release();
      }
    });

    afterEach(async () => {
      const client = await getPgPool().connect();
      try {
        await client.query(`DROP TABLE IF EXISTS person_observation_titles`);
        await client.query(`DROP TABLE IF EXISTS person_observations`);
      } finally {
        client.release();
      }
      await closePgPool();
      resetDependencyInjectionsForTesting();
    });

    it("bulk-inserts titles via UNNEST and is idempotent on a second run", async () => {
      const client = await getPgPool().connect();
      try {
        // 50 rows with a mix of shapes: multi-title arrays, some empty arrays,
        // one with case-duplicates that normalizeTitles should collapse.
        for (let i = 1; i <= 50; i += 1) {
          let titles: string | null;
          if (i % 10 === 0) {
            titles = "[]"; // empty
          } else if (i === 7) {
            // case-duplicate — normalizeTitles keeps the first casing only
            titles = JSON.stringify(["Founder", "  founder  ", "Chairman"]);
          } else if (i % 3 === 0) {
            titles = JSON.stringify([`Title ${i} A`, `Title ${i} B`]);
          } else {
            titles = JSON.stringify([`Title ${i}`]);
          }
          await client.query(
            `INSERT INTO person_observations (observation_id, titles) VALUES ($1, $2)`,
            [i, titles]
          );
        }

        // Sanity: expected observation count is 50.
        const expectedRows = await client.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM person_observations WHERE titles IS NOT NULL`
        );
        expect(Number(expectedRows.rows[0]!.c)).toBe(50);
      } finally {
        client.release();
      }

      // Expected title-row count matches normalizeTitles' semantics: every
      // tenth observation has an empty array (rows 10, 20, 30, 40, 50 → 5
      // empty). Of the 45 non-empty rows, multiples of 3 (except row 7) yield
      // 2 titles; row 7 yields 2 after case-dup collapse; the rest yield 1.
      let expected = 0;
      for (let i = 1; i <= 50; i += 1) {
        if (i % 10 === 0) continue;
        if (i === 7) {
          expected += 2;
          continue;
        }
        expected += i % 3 === 0 ? 2 : 1;
      }

      await migrateLegacyPersonObservationTitles();

      const check = await getPgPool().connect();
      try {
        const total = await check.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM person_observation_titles`
        );
        expect(Number(total.rows[0]!.c)).toBe(expected);

        const row7 = await check.query<{ title: string }>(
          `SELECT title FROM person_observation_titles WHERE observation_id = 7 ORDER BY title`
        );
        expect(row7.rows.map((r) => r.title)).toEqual(["Chairman", "Founder"]);
      } finally {
        check.release();
      }

      // Idempotent: a second run over the same source rows must not throw and
      // must not change the child-table count.
      await migrateLegacyPersonObservationTitles();
      const check2 = await getPgPool().connect();
      try {
        const total2 = await check2.query<{ c: string }>(
          `SELECT COUNT(*)::text AS c FROM person_observation_titles`
        );
        expect(Number(total2.rows[0]!.c)).toBe(expected);
      } finally {
        check2.release();
      }
    });
  }
);
