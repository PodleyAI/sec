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
  GATE_VERDICTS,
  isGateDecline,
} from "./ExtractorRunSchema";

const COLUMN = "gate_verdict";
const CIK = 7654321;
const EXTRACTOR_ID = "25-15";
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
 * Writes a run row the way every build before the column did — naming the
 * columns that existed then, and nothing else.
 */
function insertPreColumnRun(accession: string): void {
  getDb()
    .prepare(
      "INSERT INTO `extractor_runs` " +
        "(cik, accession_number, form, extractor_id, extractor_version, slot_at_run, ran_at, " +
        "success, outcome, error, read_full_submission) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      CIK,
      accession,
      "15-12G",
      EXTRACTOR_ID,
      VERSION,
      "current",
      "2026-01-01T00:00:00.000Z",
      1,
      "success",
      null,
      null
    );
}

/**
 * The whole point of the column is what a database that predates it reports.
 * Its rows are exactly the population the inference in `gatedNoOpAccessions`
 * exists to recover — filings a closed gate dropped while recording success —
 * so a reader that collapsed their null to `admitted` would assert the one
 * thing that is known to be false about many of them.
 *
 * Real SQLite, because that is the backend where a tri-state is easiest to
 * lose: the value shares an affinity-less TEXT column with the NULL, and an
 * in-memory repository would round-trip a mapping the real one gets wrong.
 */
describe("extractor_runs.gate_verdict (real SQLite)", () => {
  withSqliteDb("extractor_run_gate_verdict", [EXTRACTOR_RUN_REPOSITORY_TOKEN]);

  it("reads back null, not a decline, on a row written before the column existed", async () => {
    const accession = "0000000000-26-000101";
    const db = getDb();

    db.exec(`ALTER TABLE \`extractor_runs\` DROP COLUMN \`${COLUMN}\``);
    expect(liveColumnNames()).not.toContain(COLUMN);
    insertPreColumnRun(accession);

    // `db setup`'s additive pass is what a live database catches up through.
    addMissingColumnsSqlite(db);
    expect(liveColumnNames()).toContain(COLUMN);

    const row = await repo().findRun(CIK, accession, EXTRACTOR_ID, VERSION);
    expect(row).toBeDefined();
    expect(row?.gate_verdict).toBeNull();
    expect(row?.gate_verdict).not.toBe(GATE_VERDICTS.noSpacRow);
    // And the predicate every consumer reads it through agrees: a row nobody
    // wrote a verdict on is not evidence that a gate declined.
    expect(isGateDecline(row?.gate_verdict)).toBe(false);
  });

  it("round-trips a decline and an admission, and stores null for a caller that does not say", async () => {
    const runs = repo();
    const base = {
      cik: CIK,
      form: "15-12G",
      extractor_id: EXTRACTOR_ID,
      extractor_version: VERSION,
      slot_at_run: "current" as const,
      success: true,
      error: null,
    };
    await runs.recordRun({
      ...base,
      accession_number: "g-1",
      gate_verdict: GATE_VERDICTS.noSpacRow,
    });
    await runs.recordRun({
      ...base,
      accession_number: "g-2",
      gate_verdict: GATE_VERDICTS.admitted,
    });
    await runs.recordRun({ ...base, accession_number: "g-3" });

    expect((await runs.findRun(CIK, "g-1", EXTRACTOR_ID, VERSION))?.gate_verdict).toBe(
      GATE_VERDICTS.noSpacRow
    );
    expect((await runs.findRun(CIK, "g-2", EXTRACTOR_ID, VERSION))?.gate_verdict).toBe(
      GATE_VERDICTS.admitted
    );
    expect((await runs.findRun(CIK, "g-3", EXTRACTOR_ID, VERSION))?.gate_verdict).toBeNull();
  });

  it("keeps a permanent decline distinguishable from a repairable one", async () => {
    // The reason the column is not a boolean. Both rows say "the handler wrote
    // nothing on purpose"; only one of them is worth re-selecting once the
    // issuer's `spac` row exists, and a repair pass that could not tell them
    // apart would re-process the other on every sweep for the life of the
    // database.
    const runs = repo();
    const base = {
      cik: CIK,
      form: "RW",
      extractor_id: "RW",
      extractor_version: VERSION,
      slot_at_run: "current" as const,
      success: true,
      error: null,
    };
    await runs.recordRun({
      ...base,
      accession_number: "g-4",
      gate_verdict: GATE_VERDICTS.noSpacRow,
    });
    await runs.recordRun({
      ...base,
      accession_number: "g-5",
      gate_verdict: GATE_VERDICTS.notApplicable,
    });

    const repairable = await runs.findRun(CIK, "g-4", "RW", VERSION);
    const permanent = await runs.findRun(CIK, "g-5", "RW", VERSION);
    expect(isGateDecline(repairable?.gate_verdict)).toBe(true);
    expect(isGateDecline(permanent?.gate_verdict)).toBe(true);
    expect(repairable?.gate_verdict).not.toBe(permanent?.gate_verdict);
  });
});

describe("the add-column plan for extractor_runs.gate_verdict", () => {
  it("is plannable on both backends, so no table rebuild is needed", () => {
    // Pure, so it covers the Postgres half without a live server. A nullable
    // bounded string is exactly the shape the additive pass models; anything it
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
        sqlite: "TEXT",
        postgres: "VARCHAR(32)",
        unsupported: null,
      },
    ]);
  });
});
