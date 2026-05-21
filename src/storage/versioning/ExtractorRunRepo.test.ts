/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globalServiceRegistry, Sqlite } from "workglow";
import { DefaultDI } from "../../config/DefaultDI";
import { EnvToDI } from "../../config/EnvToDI";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { closeDb } from "../../util/db";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "./ExtractorRunSchema";
import { ExtractorRunRepo } from "./ExtractorRunRepo";

const FILING = {
  cik: 1234567,
  accession_number: "0001234567-25-000001",
  form: "D",
};

describe("ExtractorRunRepo", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("recordRun then findRun round-trips a success row", async () => {
    const repo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    await repo.recordRun({
      cik: FILING.cik,
      accession_number: FILING.accession_number,
      form: FILING.form,
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });
    const found = await repo.findRun(
      FILING.cik,
      FILING.accession_number,
      "D",
      "1.0.0"
    );
    expect(found?.success).toBe(true);
    expect(found?.error).toBeNull();
    expect(found?.slot_at_run).toBe("current");
  });

  it("recordRun then findRun round-trips a failure row", async () => {
    const repo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    await repo.recordRun({
      cik: FILING.cik,
      accession_number: FILING.accession_number,
      form: FILING.form,
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: false,
      error: "parse error: unexpected token",
    });
    const found = await repo.findRun(
      FILING.cik,
      FILING.accession_number,
      "D",
      "1.0.0"
    );
    expect(found?.success).toBe(false);
    expect(found?.error).toBe("parse error: unexpected token");
  });

  it("hasSuccessfulRun returns true only for success=true rows", async () => {
    const repo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    await repo.recordRun({
      cik: FILING.cik,
      accession_number: FILING.accession_number,
      form: FILING.form,
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: false,
      error: "first try failed",
    });
    expect(
      await repo.hasSuccessfulRun(
        FILING.cik,
        FILING.accession_number,
        "D",
        "1.0.0"
      )
    ).toBe(false);

    // Same row gets overwritten on retry (PK includes extractor_version, not ran_at)
    await repo.recordRun({
      cik: FILING.cik,
      accession_number: FILING.accession_number,
      form: FILING.form,
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });
    expect(
      await repo.hasSuccessfulRun(
        FILING.cik,
        FILING.accession_number,
        "D",
        "1.0.0"
      )
    ).toBe(true);
  });

  it("hasSuccessfulRun discriminates by extractor_version", async () => {
    const repo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    await repo.recordRun({
      cik: FILING.cik,
      accession_number: FILING.accession_number,
      form: FILING.form,
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });
    expect(
      await repo.hasSuccessfulRun(
        FILING.cik,
        FILING.accession_number,
        "D",
        "1.0.0"
      )
    ).toBe(true);
    expect(
      await repo.hasSuccessfulRun(
        FILING.cik,
        FILING.accession_number,
        "D",
        "2.0.0"
      )
    ).toBe(false);
  });

  it("listFilingsWithoutSuccessfulRun returns only unprocessed filings", async () => {
    const repo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    // Mark filing A as successful at 1.0.0
    await repo.recordRun({
      cik: 1000000,
      accession_number: "0001000000-25-000001",
      form: "D",
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });
    // Mark filing B as failed at 1.0.0 (still counts as "unprocessed")
    await repo.recordRun({
      cik: 2000000,
      accession_number: "0002000000-25-000001",
      form: "D",
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: false,
      error: "boom",
    });
    // Filing C has no run row at all

    const filings = [
      { cik: 1000000, accession_number: "0001000000-25-000001" },
      { cik: 2000000, accession_number: "0002000000-25-000001" },
      { cik: 3000000, accession_number: "0003000000-25-000001" },
    ];

    const unprocessed = await repo.listFilingsWithoutSuccessfulRun(
      filings,
      "D",
      "1.0.0"
    );

    expect(unprocessed.map((f) => f.cik).sort((a, b) => a - b)).toEqual([
      2000000, 3000000,
    ]);
  });

  it("listFilingsWithoutSuccessfulRun returns empty when all filings are done", async () => {
    const repo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    await repo.recordRun({
      cik: 1000000,
      accession_number: "0001000000-25-000001",
      form: "D",
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });
    const unprocessed = await repo.listFilingsWithoutSuccessfulRun(
      [{ cik: 1000000, accession_number: "0001000000-25-000001" }],
      "D",
      "1.0.0"
    );
    expect(unprocessed).toEqual([]);
  });

  it("listFilingsWithoutSuccessfulRun returns all input filings when no runs exist", async () => {
    const repo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    const filings = [
      { cik: 1000000, accession_number: "a" },
      { cik: 2000000, accession_number: "b" },
    ];
    const unprocessed = await repo.listFilingsWithoutSuccessfulRun(
      filings,
      "D",
      "1.0.0"
    );
    expect(unprocessed).toEqual(filings);
  });
});

// Verifies that listFilingsWithoutSuccessfulRun's boolean-criteria query
// (`{ extractor_id, extractor_version, success: true }`) actually works
// against SQLite. The in-memory tests above all pass, but PR2 never
// exercised the production code path against the real SqliteTabularStorage
// — and SQLite stores booleans as 0/1, so the query coercion needed to be
// proven, not assumed.
describe("ExtractorRunRepo with SQLite backend", () => {
  let tmpDir: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    closeDb();
    tmpDir = mkdtempSync(join(tmpdir(), "sec-extractor-runs-sqlite-"));
    savedEnv.SEC_DB_TYPE = process.env.SEC_DB_TYPE;
    savedEnv.SEC_DB_FOLDER = process.env.SEC_DB_FOLDER;
    savedEnv.SEC_DB_NAME = process.env.SEC_DB_NAME;
    process.env.SEC_DB_TYPE = "sqlite";
    process.env.SEC_DB_FOLDER = tmpDir;
    process.env.SEC_DB_NAME = "edgar";

    // Load the SQLite native binding (mirrors src/commands/index.ts).
    if (typeof Sqlite.init === "function") {
      await Sqlite.init();
    }

    // Re-init DI with sqlite-backed repos.
    EnvToDI();
    DefaultDI();
    await setupAllDatabases();
  });

  afterEach(() => {
    closeDb();
    resetDependencyInjectionsForTesting();
    rmSync(tmpDir, { recursive: true, force: true });
    for (const key of ["SEC_DB_TYPE", "SEC_DB_FOLDER", "SEC_DB_NAME"] as const) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("listFilingsWithoutSuccessfulRun works against SQLite (boolean criteria)", async () => {
    const repo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    await repo.recordRun({
      cik: 1000000,
      accession_number: "0001000000-25-000001",
      form: "D",
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });
    await repo.recordRun({
      cik: 2000000,
      accession_number: "0002000000-25-000001",
      form: "D",
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: false,
      error: "boom",
    });
    const unprocessed = await repo.listFilingsWithoutSuccessfulRun(
      [
        { cik: 1000000, accession_number: "0001000000-25-000001" },
        { cik: 2000000, accession_number: "0002000000-25-000001" },
        { cik: 3000000, accession_number: "0003000000-25-000001" },
      ],
      "D",
      "1.0.0"
    );
    expect(unprocessed.map((f) => f.cik).sort((a, b) => a - b)).toEqual([
      2000000, 3000000,
    ]);
  });
});
