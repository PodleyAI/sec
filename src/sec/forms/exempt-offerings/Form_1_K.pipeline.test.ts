/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Round-trip pipeline test for Form 1-K (Reg-A annual report):
 * XML -> parse -> store -> query the repos.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
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
  let regARepo: RegAOfferingRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    regARepo = new RegAOfferingRepo();
  });

  async function ingestAll(
    slug: string = FIXTURE_SLUG,
    formCode: "1-K" | "1-K/A" = "1-K"
  ): Promise<IngestedFixture[]> {
    const ingested: IngestedFixture[] = [];
    const summary = await runPipeline(slug, async (file, xml) => {
      const parsed = await Form_1_K.parse(formCode, xml);
      const form1K = parsed.cover;
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
        form: formCode,
        form1K: parsed,
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
    // the offering already closed, so the history table is sparse. The
    // upper bound is one row per filing (processOfferingHistory writes at
    // most one row per summaryInfo entry, keyed on (cik, file_number,
    // accession_number) -- and we use a distinct file_number per filing).
    expect(histories.length).toBeGreaterThan(0);
    expect(histories.length).toBeLessThanOrEqual(ingested.length);
  });

  it("links the issuer back to its CIK via company observations", async () => {
    const ingested = await ingestAll();
    const allObs = await new CompanyObservationRepo().listAll();
    const issuerObs = allObs.filter((o) => {
      try {
        return JSON.parse(o.source_context ?? "{}").relation === "form-1k:issuer";
      } catch {
        return false;
      }
    });
    expect(issuerObs.length).toBeGreaterThan(0);
  });

  it("ingests a 1-K/A amendment via the same pipeline", async () => {
    const files = listFixtureFiles("form-1-k-a");
    if (files.length === 0) return;
    const sample = files.slice(0, Math.min(5, files.length));
    for (const file of sample) {
      const xml = readFixture("form-1-k-a", file);
      const parsed = await Form_1_K.parse("1-K/A", xml);
      const form1K = parsed.cover;
      const accession = accessionFromFixtureName(file);
      const cik = safeCikToInt(form1K.formData.item1Info[0]?.cik);
      const fileNumber = deriveFileNumber(accession);
      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        form: "1-K/A",
        form1K: parsed,
      });
    }
    const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
    expect(histories.length).toBeGreaterThanOrEqual(1);
  });
});
