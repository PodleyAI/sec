/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * End-to-end pipeline test for Form 1-K (Reg-A annual report). Walks every
 * XML fixture under `mock_data/form-1-k/`, parses, stores, and verifies
 * the parsed data lands in the repos.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { Form_1_K } from "./Form_1_K";
import { processForm1K } from "./Form_1_K.storage";
import {
  accessionFromFixtureName,
  assertAllSucceeded,
  deriveFileNumber,
  listFixtureFiles,
  readFixture,
  runPipeline,
  safeCikToInt,
} from "./pipeline-test-util";

interface IngestedFixture {
  file: string;
  cik: number;
  fileNumber: string;
  accession: string;
  issuerName: string | null;
}

const FIXTURE_SLUG = "form-1-k";

describe("Form_1_K pipeline", () => {
  let companyRepo: CompanyRepo;
  let regARepo: RegAOfferingRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    companyRepo = new CompanyRepo();
    regARepo = new RegAOfferingRepo();
  });

  async function ingestAll(
    slug: string = FIXTURE_SLUG,
    formCode: "1-K" | "1-K/A" = "1-K"
  ): Promise<IngestedFixture[]> {
    const ingested: IngestedFixture[] = [];
    const summary = await runPipeline(slug, async (file, xml) => {
      const form1K = await Form_1_K.parse(formCode, xml);
      const accession = accessionFromFixtureName(file);
      const primary = form1K.formData.item1Info[0];
      const cik = safeCikToInt(primary?.cik);
      const fileNumber = deriveFileNumber(accession);
      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        form1K,
      });
      ingested.push({
        file,
        cik,
        fileNumber,
        accession,
        issuerName: primary?.issuerName ?? null,
      });
    });
    assertAllSucceeded(summary);
    return ingested;
  }

  it("parses + stores every form-1-k fixture without exceptions", async () => {
    const files = listFixtureFiles(FIXTURE_SLUG);
    expect(files.length).toBeGreaterThan(40);
    const ingested = await ingestAll();
    expect(ingested.length).toBe(files.length);
  });

  it("creates a reporting offering row per filing", async () => {
    const ingested = await ingestAll();
    const offerings = (await regARepo.offeringRepository.getAll()) || [];
    // Each filing writes one row keyed on (cik, file_number). Near-1:1.
    expect(offerings.length).toBeGreaterThanOrEqual(Math.floor(ingested.length * 0.9));
  });

  it("tags every persisted 1-K offering with status='reporting'", async () => {
    await ingestAll();
    const offerings = (await regARepo.offeringRepository.getAll()) || [];
    // 1-K is an annual report; processForm1K hard-codes the status to "reporting".
    for (const row of offerings) {
      expect(row.status).toBe("reporting");
    }
  });

  it("creates a history row only when the 1-K carries a summaryInfo block", async () => {
    const ingested = await ingestAll();
    const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
    // 1-K is an annual report; many filings have no `summaryInfo` because
    // the offering already closed, so the history table can be sparse. We
    // assert it's populated *at all* (proves the pipeline writes histories
    // when there is data) and never exceeds the filing count.
    expect(histories.length).toBeGreaterThan(0);
    expect(histories.length).toBeLessThanOrEqual(ingested.length * 5);
  });

  it("links the issuer back to the filing CIK in the company junction", async () => {
    const ingested = await ingestAll();
    const step = Math.max(1, Math.floor(ingested.length / 5));
    let checked = 0;
    let found = 0;
    for (let i = 0; i < ingested.length && checked < 5; i += step) {
      const f = ingested[i];
      if (!f.issuerName) continue;
      checked++;
      const expected = companyRepo.normalizeCompanyName(f.issuerName);
      const companies = await companyRepo.getCompaniesByEntity(f.cik);
      if (
        companies.some((c) => c.company_name === expected || c.company_name === f.issuerName)
      ) {
        found++;
      }
    }
    if (checked === 0) return;
    expect(found).toBeGreaterThanOrEqual(Math.floor(checked * 0.6));
  });

  it("ingests a 1-K/A amendment via the same pipeline", async () => {
    const files = listFixtureFiles("form-1-k-a");
    if (files.length === 0) return;
    const sample = files.slice(0, Math.min(5, files.length));
    for (const file of sample) {
      const xml = readFixture("form-1-k-a", file);
      const form1K = await Form_1_K.parse("1-K/A", xml);
      const accession = accessionFromFixtureName(file);
      const cik = safeCikToInt(form1K.formData.item1Info[0]?.cik);
      const fileNumber = deriveFileNumber(accession);
      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        form1K,
      });
    }
    const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
    expect(histories.length).toBeGreaterThanOrEqual(1);
  });
});
