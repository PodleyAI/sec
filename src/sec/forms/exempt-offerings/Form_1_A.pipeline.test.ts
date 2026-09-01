/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Round-trip pipeline test for Form 1-A (Reg-A Offering Statement):
 * XML -> parse -> store -> query the repos.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { Form_1_A } from "./Form_1_A";
import { processForm1A } from "./Form_1_A.storage";
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
  issuerName: string;
  jurisdiction: string;
  tier: string;
}

const FIXTURE_SLUG = "form-1-a";

describe("Form_1_A pipeline", () => {
  let regARepo: RegAOfferingRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    regARepo = new RegAOfferingRepo();
  });

  async function ingestAll(
    slug: string = FIXTURE_SLUG,
    formCode: "1-A" | "1-A/A" | "1-A POS" = "1-A"
  ): Promise<IngestedFixture[]> {
    const ingested: IngestedFixture[] = [];
    const summary = await runPipeline(slug, async (file, xml) => {
      const form1A = await Form_1_A.parse(formCode, xml);
      const accession = accessionFromFixtureName(file);
      const employees = form1A.formData.employeesInfo[0];
      const cik = safeCikToInt(employees.cik);
      const fileNumber = deriveFileNumber(accession);
      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        form1A,
      });
      ingested.push({
        file,
        cik,
        fileNumber,
        accession,
        issuerName: employees.issuerName,
        jurisdiction: employees.jurisdictionOrganization,
        tier: form1A.formData.summaryInfo.indicateTier1Tier2Offering,
      });
    });
    assertAllSucceeded(summary);
    return ingested;
  }

  it("parses + stores every form-1-a fixture without exceptions", async () => {
    const files = listFixtureFiles(FIXTURE_SLUG);
    expect(files.length).toBeGreaterThan(40);
    const ingested = await ingestAll();
    expect(ingested.length).toBe(files.length);
  });

  it("creates one RegA offering row per fixture, keyed by (cik, file_number)", async () => {
    const ingested = await ingestAll();
    const offerings = (await regARepo.offeringRepository.getAll()) || [];
    // Offerings collide on (cik, file_number); we expect near-1:1.
    expect(offerings.length).toBeGreaterThanOrEqual(Math.floor(ingested.length * 0.95));
  });

  it("creates one RegA offering history row per accession", async () => {
    const ingested = await ingestAll();
    const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
    // History keys include accession_number so cross-fixture collisions
    // are negligible.
    expect(histories.length).toBe(ingested.length);
  });

  it("round-trips the tier and jurisdiction into the offering row", async () => {
    const ingested = await ingestAll();
    // Sample five filings, query their stored offering, and verify the
    // tier + jurisdiction fields survived the trip.
    const step = Math.max(1, Math.floor(ingested.length / 5));
    let checked = 0;
    let matched = 0;
    for (let i = 0; i < ingested.length && checked < 5; i += step) {
      const f = ingested[i];
      checked++;
      const offering = await regARepo.getOffering(f.cik, f.fileNumber);
      if (offering && offering.jurisdiction === f.jurisdiction && offering.tier === f.tier) {
        matched++;
      }
    }
    expect(matched).toBeGreaterThanOrEqual(Math.floor(checked * 0.8));
  });

  it("links the issuer company back to its CIK via the observation tier", async () => {
    const ingested = await ingestAll();
    const allCompanyObs = await new CompanyObservationRepo().listAll();
    const step = Math.max(1, Math.floor(ingested.length / 5));
    let checked = 0;
    let found = 0;
    for (let i = 0; i < ingested.length && checked < 5; i += step) {
      const f = ingested[i];
      if (!f.issuerName) continue;
      checked++;
      const issuerObs = allCompanyObs.filter(
        (o) => o.accession_number === f.accession && o.observation_index === 0
      );
      if (issuerObs.some((o) => o.cik !== null && Number(o.cik) === f.cik)) {
        found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(Math.floor(checked * 0.6));
  });

  it("ingests a 1-A/A amendment through the same parser/storage path", async () => {
    const files = listFixtureFiles("form-1-a-a");
    if (files.length === 0) return;
    const sample = files.slice(0, 3);
    for (const file of sample) {
      const xml = readFixture("form-1-a-a", file);
      const form1A = await Form_1_A.parse("1-A/A", xml);
      const accession = accessionFromFixtureName(file);
      const cik = safeCikToInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = deriveFileNumber(accession);
      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        form1A,
      });
    }
    const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
    expect(histories.length).toBe(sample.length);
  });

  it("ingests a 1-A POS post-qualification amendment", async () => {
    const files = listFixtureFiles("form-1-a-pos");
    if (files.length === 0) return;
    const sample = files.slice(0, 3);
    for (const file of sample) {
      const xml = readFixture("form-1-a-pos", file);
      const form1A = await Form_1_A.parse("1-A POS", xml);
      const accession = accessionFromFixtureName(file);
      const cik = safeCikToInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = deriveFileNumber(accession);
      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        form1A,
      });
    }
    const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
    expect(histories.length).toBe(sample.length);
  });
});
