/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SpacRepo } from "./SpacRepo";
import { SpacReportWriter } from "./SpacReportWriter";
import { withSpacCikLock } from "./SpacWriteLock";

describe("withSpacCikLock", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("serializes per-CIK writers (in-memory backend)", async () => {
    // Two concurrent callers on the same CIK must not overlap. The slow inner
    // function records start/end and verifies no observed overlap.
    let inFlight = 0;
    let maxInFlight = 0;
    const repo = new SpacRepo();

    async function critical(): Promise<void> {
      inFlight++;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
    }

    await Promise.all([
      withSpacCikLock(100, repo.dealRepository, critical),
      withSpacCikLock(100, repo.dealRepository, critical),
      withSpacCikLock(100, repo.dealRepository, critical),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it("locks are scoped per CIK — different CIKs do not block each other", async () => {
    const repo = new SpacRepo();
    let aStarted = false;
    let bStarted = false;
    let bothInFlightAtSomePoint = false;

    await Promise.all([
      withSpacCikLock(101, repo.dealRepository, async () => {
        aStarted = true;
        // Wait briefly so the other lock has a chance to acquire.
        for (let i = 0; i < 10 && !bStarted; i++) {
          await new Promise((r) => setTimeout(r, 5));
        }
        if (bStarted) bothInFlightAtSomePoint = true;
      }),
      withSpacCikLock(102, repo.dealRepository, async () => {
        bStarted = true;
        for (let i = 0; i < 10 && !aStarted; i++) {
          await new Promise((r) => setTimeout(r, 5));
        }
      }),
    ]);

    expect(bothInFlightAtSomePoint).toBe(true);
  });

  it("three parallel SpacReportWriter rebuilds on the same CIK leave exactly one open history row", async () => {
    // Without the per-CIK lock, three concurrent writers could each observe
    // the same set of history rows and each emit a new open row, leaving
    // multiple valid_to = null rows. Under the lock, exactly one open row
    // remains after all writers complete.
    const writer = new SpacReportWriter();
    const repo = new SpacRepo();
    await Promise.all([
      writer.recordRegistration({
        cik: 200,
        accession_number: "200-reg-a",
        filing_date: "2026-01-01",
        form: "S-1",
        primary_document: "s1.htm",
        spac_name: "Parallel SPAC A",
        spac_sic: 6770,
      }),
      writer.recordRegistration({
        cik: 200,
        accession_number: "200-reg-b",
        filing_date: "2026-01-02",
        form: "S-1/A",
        primary_document: "s1a.htm",
        spac_name: "Parallel SPAC B",
        spac_sic: 6770,
      }),
      writer.recordRegistration({
        cik: 200,
        accession_number: "200-reg-c",
        filing_date: "2026-01-03",
        form: "S-1/A",
        primary_document: "s1a.htm",
        spac_name: "Parallel SPAC C",
        spac_sic: 6770,
      }),
    ]);

    const history = await repo.getHistory(200);
    const open = history.filter((h) => h.valid_to == null);
    expect(open.length).toBe(1);
  });
});
