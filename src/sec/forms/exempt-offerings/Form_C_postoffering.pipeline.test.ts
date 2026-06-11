/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CrowdfundingRepo } from "../../../storage/portal/CrowdfundingRepo";
import { Form_C } from "./Form_C";
import { determineStatus, processFormC } from "./Form_C.storage";
import {
  accessionFromFixtureName,
  assertAllSucceeded,
  deriveFileNumber,
  listFixtureFiles,
  readFixture,
  runPipeline,
  safeCikToInt,
} from "./pipeline-test-util";

const CASES = [
  // C-U fixtures all carry offeringInformation; C-AR fixtures all carry the
  // annual-report disclosure battery. Asserting those tables (not just the
  // status string) keeps the form-specific storage paths covered.
  { slug: "form-c-u", form: "C-U" as const, status: "progress-update", stores: "offerings" },
  { slug: "form-c-ar", form: "C-AR" as const, status: "annual-report", stores: "reports" },
  { slug: "form-c-tr", form: "C-TR" as const, status: "termination", stores: null },
] as const;

describe("determineStatus", () => {
  // The -W post-offering codes withdraw the referenced filing, not the
  // offering: blanket "withdrawn" (or the base status) would misstate it.
  const EXPECTED: ReadonlyArray<[string, string]> = [
    ["C", "active"],
    ["C/A", "amended"],
    ["C-W", "withdrawn"],
    ["C/A-W", "amended"],
    ["C-U", "progress-update"],
    ["C-U-W", "progress-update-withdrawn"],
    ["C-AR", "annual-report"],
    ["C-AR/A", "annual-report"],
    ["C-AR-W", "annual-report-withdrawn"],
    ["C-AR/A-W", "annual-report-withdrawn"],
    ["C-TR", "termination"],
    ["C-TR-W", "termination-withdrawn"],
  ];

  for (const [code, expected] of EXPECTED) {
    it(`maps ${code} -> ${expected}`, () => {
      expect(determineStatus(code)).toBe(expected);
    });
  }
});

describe("Form C post-offering pipeline (C-U / C-AR / C-TR)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  for (const { slug, form, status, stores } of CASES) {
    it(`stores every ${form} fixture and round-trips status "${status}"`, async () => {
      const files = listFixtureFiles(slug);
      expect(files.length).toBeGreaterThan(0);
      const ciks: number[] = [];

      const summary = await runPipeline(slug, async (file, xml) => {
        const parsed = await Form_C.parse(form, xml);
        const accession = accessionFromFixtureName(file);
        const cik = safeCikToInt(parsed.headerData.filerInfo.filer.filerCredentials.filerCik);
        ciks.push(cik);
        await processFormC({
          cik,
          file_number: deriveFileNumber(accession),
          accession_number: accession,
          filing_date: "2025-04-28",
          primary_doc: "primary_doc.xml",
          formC: parsed,
        });
      });
      assertAllSucceeded(summary);

      const repo = new CrowdfundingRepo();
      const rows = await repo.getCrowdfundingByCik(ciks[0]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].status).toBe(status);

      if (stores === "offerings") {
        expect((await repo.getCrowdfundingOfferingsByCik(ciks[0])).length).toBeGreaterThan(0);
      } else if (stores === "reports") {
        expect((await repo.getCrowdfundingReportsByCik(ciks[0])).length).toBeGreaterThan(0);
      }
      if (form === "C-U") {
        // The progress narrative is the C-U's defining payload.
        expect(rows[0].progress_update).toBeTruthy();
      }
    });
  }

  it("preserves the portal link and issuer details when a post-offering filing follows the Form C", async () => {
    const repo = new CrowdfundingRepo();
    const files = listFixtureFiles("form-c-ar");
    const xml = readFixture("form-c-ar", files[0]);
    const parsed = await Form_C.parse("C-AR", xml);
    const cik = safeCikToInt(parsed.headerData.filerInfo.filer.filerCredentials.filerCik);
    const file_number = "020-99999";

    // Simulate the original Form C having established the portal link.
    await repo.saveCrowdfunding({
      cik,
      file_number,
      filing_date: "2024-01-15",
      name: "Original Issuer",
      legal_status: "Corporation",
      state_jurisdiction: "DE",
      date_incorporation: "2020-01-01",
      url: "https://issuer.example.com",
      portal_cik: 1725012,
      status: "active",
    });

    await processFormC({
      cik,
      file_number,
      accession_number: accessionFromFixtureName(files[0]),
      filing_date: "2025-04-28",
      primary_doc: "primary_doc.xml",
      formC: parsed,
    });

    const updated = await repo.getCrowdfunding(cik, file_number);
    expect(updated?.status).toBe("annual-report");
    // The C-AR carries no <commissionCik>; the portal link must survive.
    expect(updated?.portal_cik).toBe(1725012);
  });

  it("ignores an out-of-order replay of an older filing on the mutable row", async () => {
    const repo = new CrowdfundingRepo();
    const files = listFixtureFiles("form-c-ar");
    const xml = readFixture("form-c-ar", files[0]);
    const parsed = await Form_C.parse("C-AR", xml);
    const cik = safeCikToInt(parsed.headerData.filerInfo.filer.filerCredentials.filerCik);
    const file_number = "020-88888";

    await repo.saveCrowdfunding({
      cik,
      file_number,
      filing_date: "2026-01-01",
      name: "Current Issuer",
      legal_status: "Corporation",
      state_jurisdiction: "DE",
      date_incorporation: "2020-01-01",
      url: "https://issuer.example.com",
      portal_cik: 1725012,
      status: "termination",
      progress_update: null,
      nature_of_amendment: null,
    });

    // The replayed C-AR is older than the row's filing_date: skipped.
    await processFormC({
      cik,
      file_number,
      accession_number: accessionFromFixtureName(files[0]),
      filing_date: "2025-04-28",
      primary_doc: "primary_doc.xml",
      formC: parsed,
    });

    const row = await repo.getCrowdfunding(cik, file_number);
    expect(row?.status).toBe("termination");
    expect(row?.filing_date).toBe("2026-01-01");
  });
});
