/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { setupAllDatabases } from "../config/setupAllDatabases";
import { assembleSpacReport } from "./spac";
import { SpacReportWriter } from "../storage/spac/SpacReportWriter";

describe("assembleSpacReport", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("assembles row + events for a populated SPAC", async () => {
    await new SpacReportWriter().recordRegistration({
      cik: 99,
      accession_number: "reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: null,
      spac_name: "Test SPAC",
      spac_sic: 6770,
    });
    const report = await assembleSpacReport(99);
    expect(report.spac?.spac_name).toBe("Test SPAC");
    expect(report.events.length).toBe(1);
    expect(report.sponsorCount).toBe(0);
  });
});
