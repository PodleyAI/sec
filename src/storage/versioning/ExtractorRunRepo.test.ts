/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, Sqlite } from "workglow";
import { DefaultDI } from "../../config/DefaultDI";
import { EnvToDI } from "../../config/EnvToDI";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { closeDb } from "../../util/db";
import { ExtractorRunRepo } from "./ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "./ExtractorRunSchema";

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
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
    const found = await repo.findRun(FILING.cik, FILING.accession_number, "D", "1.0.0");
    expect(found?.success).toBe(true);
    expect(found?.error).toBeNull();
    expect(found?.slot_at_run).toBe("current");
  });

  it("recordRun then findRun round-trips a failure row", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
    const found = await repo.findRun(FILING.cik, FILING.accession_number, "D", "1.0.0");
    expect(found?.success).toBe(false);
    expect(found?.error).toBe("parse error: unexpected token");
  });

  it("hasSuccessfulRun returns true only for success=true rows", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
    expect(await repo.hasSuccessfulRun(FILING.cik, FILING.accession_number, "D", "1.0.0")).toBe(
      false
    );

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
    expect(await repo.hasSuccessfulRun(FILING.cik, FILING.accession_number, "D", "1.0.0")).toBe(
      true
    );
  });

  it("hasSuccessfulRun discriminates by extractor_version", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
    expect(await repo.hasSuccessfulRun(FILING.cik, FILING.accession_number, "D", "1.0.0")).toBe(
      true
    );
    expect(await repo.hasSuccessfulRun(FILING.cik, FILING.accession_number, "D", "2.0.0")).toBe(
      false
    );
  });

  it("listFilingsWithoutSuccessfulRun returns only unprocessed filings", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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

    const unprocessed = await repo.listFilingsWithoutSuccessfulRun(filings, "D", "1.0.0");

    expect(unprocessed.map((f) => f.cik).sort((a, b) => a - b)).toEqual([2000000, 3000000]);
  });

  it("listFilingsWithoutSuccessfulRun returns empty when all filings are done", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const filings = [
      { cik: 1000000, accession_number: "a" },
      { cik: 2000000, accession_number: "b" },
    ];
    const unprocessed = await repo.listFilingsWithoutSuccessfulRun(filings, "D", "1.0.0");
    expect(unprocessed).toEqual(filings);
  });

  it("listFilingsWithoutSuccessfulRun with form filter narrows the successful set", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    // Filing A: successful at form="D"
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
    // Filing B: successful at form="D/A" (same extractor "D", different form variant)
    await repo.recordRun({
      cik: 2000000,
      accession_number: "0002000000-25-000001",
      form: "D/A",
      extractor_id: "D",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });

    // Without the form filter, both filings count as done.
    const noFilter = await repo.listFilingsWithoutSuccessfulRun(
      [
        { cik: 1000000, accession_number: "0001000000-25-000001" },
        { cik: 2000000, accession_number: "0002000000-25-000001" },
      ],
      "D",
      "1.0.0"
    );
    expect(noFilter).toEqual([]);

    // With form="D", only the D-form success row counts; Filing B looks unprocessed.
    const dOnly = await repo.listFilingsWithoutSuccessfulRun(
      [
        { cik: 1000000, accession_number: "0001000000-25-000001" },
        { cik: 2000000, accession_number: "0002000000-25-000001" },
      ],
      "D",
      "1.0.0",
      "D"
    );
    expect(dOnly.map((f) => f.cik)).toEqual([2000000]);
  });

  it("listFilingsWithoutSuccessfulRun treats patch versions as equivalent (1.0.0 row counts for 1.0.1 gate)", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    // Filing was processed at version 1.0.0.
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

    // After a patch bump to 1.0.1, the same filing should NOT show as unprocessed.
    const unprocessed = await repo.listFilingsWithoutSuccessfulRun(
      [{ cik: 1000000, accession_number: "0001000000-25-000001" }],
      "D",
      "1.0.1",
      "D"
    );
    expect(unprocessed).toEqual([]);
  });

  it("findLatestRun returns undefined when no run exists", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const found = await repo.findLatestRun(FILING.cik, FILING.accession_number, "D");
    expect(found).toBeUndefined();
  });

  it("findLatestRun returns the row with the most recent ran_at across versions", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
    // Force a distinct ran_at timestamp so ordering isn't a same-millisecond
    // coin flip (recordRun stamps ran_at internally with Date.now()).
    await new Promise((resolve) => setTimeout(resolve, 5));
    // A later run at a different version should be reported as latest even
    // though findLatestRun does not filter by extractor_version.
    await repo.recordRun({
      cik: FILING.cik,
      accession_number: FILING.accession_number,
      form: FILING.form,
      extractor_id: "D",
      extractor_version: "1.1.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });
    const found = await repo.findLatestRun(FILING.cik, FILING.accession_number, "D");
    expect(found?.extractor_version).toBe("1.1.0");
  });

  it("listFilingsWithoutSuccessfulRun does NOT count rows across major.minor boundary", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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

    // Gate at 1.1.0 (minor bump) — old 1.0.0 row should NOT count.
    const afterMinor = await repo.listFilingsWithoutSuccessfulRun(
      [{ cik: 1000000, accession_number: "0001000000-25-000001" }],
      "D",
      "1.1.0",
      "D"
    );
    expect(afterMinor).toHaveLength(1);

    // Gate at 2.0.0 (major bump) — also shouldn't count.
    const afterMajor = await repo.listFilingsWithoutSuccessfulRun(
      [{ cik: 1000000, accession_number: "0001000000-25-000001" }],
      "D",
      "2.0.0",
      "D"
    );
    expect(afterMajor).toHaveLength(1);
  });
});

// Verifies that listFilingsWithoutSuccessfulRun's boolean-criteria query
// (`{ extractor_id, extractor_version, success: true }`) actually works
// against SQLite. The in-memory tests above all pass, but earlier tests never
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
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
    expect(unprocessed.map((f) => f.cik).sort((a, b) => a - b)).toEqual([2000000, 3000000]);
  });

  it("recordRun with outcome=partial sets success=false and partial outcome", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    await repo.recordRun({
      cik: FILING.cik,
      accession_number: FILING.accession_number,
      form: FILING.form,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: false, // overridden by outcome
      outcome: "partial",
      error: null,
    });
    const found = await repo.findRun(FILING.cik, FILING.accession_number, "S-1", "1.0.0");
    expect(found?.outcome).toBe("partial");
    expect(found?.success).toBe(false);
  });

  it("countSuccessfulAtVersion does not count partial runs", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    await repo.recordRun({
      cik: 1000000,
      accession_number: "0001000000-25-000001",
      form: "S-1",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      outcome: "success",
      error: null,
    });
    await repo.recordRun({
      cik: 2000000,
      accession_number: "0002000000-25-000001",
      form: "S-1",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: false,
      outcome: "partial",
      error: null,
    });
    expect(await repo.countSuccessfulAtVersion("S-1", "1.0.0")).toBe(1);
  });

  it("listFilingsWithoutSuccessfulRun treats partial runs as not-successful", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    await repo.recordRun({
      cik: 1000000,
      accession_number: "0001000000-25-000001",
      form: "S-1",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: false,
      outcome: "partial",
      error: null,
    });
    const unprocessed = await repo.listFilingsWithoutSuccessfulRun(
      [{ cik: 1000000, accession_number: "0001000000-25-000001" }],
      "S-1",
      "1.0.0"
    );
    expect(unprocessed.length).toBe(1);
  });

  it("legacy rows without outcome are inferred from success boolean", async () => {
    // Default recordRun (no outcome) infers from success: true -> success;
    // false -> failure. countSuccessfulAtVersion counts the inferred success.
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
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
    expect(await repo.countSuccessfulAtVersion("D", "1.0.0")).toBe(1);
  });

  it("deleteForCikExtractors removes only the named extractors at the active generation", async () => {
    // The unscoped per-issuer wipe this replaced also took the CIK's Form D,
    // ownership and prior-version rows — an audit trail the coverage gate
    // counts and nothing can rebuild.
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const seed = async (
      cik: number,
      accession_number: string,
      extractor_id: string,
      extractor_version: string
    ): Promise<void> => {
      await repo.recordRun({
        cik,
        accession_number,
        form: extractor_id,
        extractor_id,
        extractor_version,
        slot_at_run: "current",
        success: true,
        error: null,
      });
    };
    await seed(1000001, "0001000001-25-000001", "8-K", "1.0.0");
    await seed(1000001, "0001000001-25-000002", "D", "1.0.0");
    await seed(1000001, "0001000001-25-000003", "8-K", "0.9.0");
    await seed(2000002, "0002000002-25-000001", "8-K", "1.0.0");

    await repo.deleteForCikExtractors(1000001, new Map([["8-K", "1.0.0"]]));

    expect(await repo.findRun(1000001, "0001000001-25-000001", "8-K", "1.0.0")).toBeUndefined();
    expect((await repo.findRun(1000001, "0001000001-25-000002", "D", "1.0.0"))?.success).toBe(true);
    expect((await repo.findRun(1000001, "0001000001-25-000003", "8-K", "0.9.0"))?.success).toBe(
      true
    );
    expect((await repo.findRun(2000002, "0002000002-25-000001", "8-K", "1.0.0"))?.success).toBe(
      true
    );
  });

  it("deleteForCikExtractors deletes nothing when no extractor is named", async () => {
    const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    await repo.recordRun({
      cik: 1000001,
      accession_number: "0001000001-25-000001",
      form: "8-K",
      extractor_id: "8-K",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      success: true,
      error: null,
    });

    await repo.deleteForCikExtractors(1000001, new Map());

    expect((await repo.findRun(1000001, "0001000001-25-000001", "8-K", "1.0.0"))?.success).toBe(
      true
    );
  });
});
