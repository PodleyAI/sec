/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { addMissingColumnsSqlite, planMissingColumns } from "../../config/addMissingColumns";
import type { RegisteredTable } from "../../config/tableRegistry";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { getDb } from "../../util/db";
import { ExtractorRunRepo } from "./ExtractorRunRepo";
import {
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  ExtractorRunPrimaryKeyNames,
  ExtractorRunSchema,
} from "./ExtractorRunSchema";

const COLUMN = "read_full_submission";
const CIK = 1234567;
const EXTRACTOR_ID = "8-K";
const VERSION = "1.0.0";

function repo(): ExtractorRunRepo {
  return new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
}

function liveColumnNames(): string[] {
  return getDb()
    .prepare<[], { name: string }>("PRAGMA table_info(`extractor_runs`)")
    .all()
    .map((r) => r.name);
}

/**
 * Writes a run row the way every build before the column did — naming the ten
 * columns that existed then, and nothing else.
 */
function insertPreColumnRun(accession: string): void {
  getDb()
    .prepare(
      "INSERT INTO `extractor_runs` " +
        "(cik, accession_number, form, extractor_id, extractor_version, slot_at_run, ran_at, success, outcome, error) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      CIK,
      accession,
      "8-K",
      EXTRACTOR_ID,
      VERSION,
      "current",
      "2026-01-01T00:00:00.000Z",
      1,
      "success",
      null
    );
}

/**
 * The column is tri-state on purpose, so what a database that predates it
 * reports is the whole question: every one of its rows must read as "not
 * recorded", and a reader that collapsed that to `false` would assert the
 * extractor saw only the primary document on runs where nobody looked.
 *
 * Real SQLite, because that is the backend where the distinction is easiest to
 * lose: SQLite has no BOOLEAN type, so a boolean lives in an INTEGER-affinity
 * column alongside the NULL, and an in-memory repository would round-trip a
 * mapping the real one gets wrong.
 */
describe("extractor_runs.read_full_submission (real SQLite)", () => {
  withSqliteDb("extractor_run_full_submission", [EXTRACTOR_RUN_REPOSITORY_TOKEN]);

  it("reads back null, not false, on a row written before the column existed", async () => {
    const accession = "0000000000-26-000001";
    const db = getDb();

    db.exec(`ALTER TABLE \`extractor_runs\` DROP COLUMN \`${COLUMN}\``);
    expect(liveColumnNames()).not.toContain(COLUMN);
    insertPreColumnRun(accession);

    // `db setup`'s additive pass is what a live database catches up through.
    addMissingColumnsSqlite(db);
    expect(liveColumnNames()).toContain(COLUMN);

    const row = await repo().findRun(CIK, accession, EXTRACTOR_ID, VERSION);
    expect(row).toBeDefined();
    expect(row?.read_full_submission).toBeNull();
    expect(row?.read_full_submission).not.toBe(false);
  });

  it("round-trips true and false, and stores null for a caller that does not say", async () => {
    const runs = repo();
    const base = {
      cik: CIK,
      form: "8-K",
      extractor_id: EXTRACTOR_ID,
      extractor_version: VERSION,
      slot_at_run: "current" as const,
      success: true,
      error: null,
    };
    await runs.recordRun({ ...base, accession_number: "a-1", read_full_submission: true });
    await runs.recordRun({ ...base, accession_number: "a-2", read_full_submission: false });
    await runs.recordRun({ ...base, accession_number: "a-3" });

    expect((await runs.findRun(CIK, "a-1", EXTRACTOR_ID, VERSION))?.read_full_submission).toBe(
      true
    );
    expect((await runs.findRun(CIK, "a-2", EXTRACTOR_ID, VERSION))?.read_full_submission).toBe(
      false
    );
    expect(
      (await runs.findRun(CIK, "a-3", EXTRACTOR_ID, VERSION))?.read_full_submission
    ).toBeNull();
  });
});

describe("the add-column plan for extractor_runs.read_full_submission", () => {
  it("is plannable on both backends, so no table rebuild is needed", () => {
    // Pure, so it covers the Postgres half without a live server. A nullable
    // boolean is exactly the shape the additive pass models; anything it
    // declined would surface here as a null DDL plus a reason.
    const declared: RegisteredTable[] = [
      {
        table: "extractor_runs",
        schema: ExtractorRunSchema as unknown as RegisteredTable["schema"],
        primaryKeyNames: [...ExtractorRunPrimaryKeyNames],
      },
    ];
    const preColumn = Object.keys(ExtractorRunSchema.properties).filter((c) => c !== COLUMN);

    const plan = planMissingColumns(declared, new Map([["extractor_runs", new Set(preColumn)]]));

    expect(plan).toEqual([
      {
        table: "extractor_runs",
        column: COLUMN,
        sqlite: "INTEGER",
        postgres: "BOOLEAN",
        unsupported: null,
      },
    ]);
  });
});
