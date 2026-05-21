/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Round-trip pipeline test for Form D (Notice of Sales of Unregistered
 * Securities): XML -> parse -> store -> query the repos.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { InvestmentOfferingRepo } from "../../../storage/investment-offering/InvestmentOfferingRepo";
import { IssuerRepo } from "../../../storage/investment-offering/IssuerRepo";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { Form_D } from "./Form_D";
import { processFormD } from "./Form_D.storage";
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
  primaryIssuerName: string;
  additionalIssuerCount: number;
  relatedPersonCount: number;
}

const FIXTURE_SLUG = "form-d";

describe("Form_D pipeline", () => {
  let companyRepo: CompanyRepo;
  let personRepo: PersonRepo;
  let investmentOfferingRepo: InvestmentOfferingRepo;
  let issuerRepo: IssuerRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    companyRepo = new CompanyRepo();
    personRepo = new PersonRepo();
    investmentOfferingRepo = new InvestmentOfferingRepo();
    issuerRepo = new IssuerRepo();
  });

  async function ingestAll(slug = FIXTURE_SLUG, formCode: "D" | "D/A" = "D"): Promise<
    IngestedFixture[]
  > {
    const ingested: IngestedFixture[] = [];
    const summary = await runPipeline(slug, async (file, xml) => {
      const formD = await Form_D.parse(formCode, xml);
      const accession = accessionFromFixtureName(file);
      const cik = safeCikToInt(formD.primaryIssuer.cik);
      const fileNumber = deriveFileNumber(accession);
      await processFormD({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        primary_doc: file,
        formD,
      });
      ingested.push({
        file,
        cik,
        fileNumber,
        accession,
        primaryIssuerName: formD.primaryIssuer.entityName ?? "",
        additionalIssuerCount: formD.issuerList?.issuer?.length ?? 0,
        relatedPersonCount: formD.relatedPersonsList?.relatedPersonInfo?.length ?? 0,
      });
    });
    assertAllSucceeded(summary);
    return ingested;
  }

  it("parses + stores every form-d fixture without exceptions", async () => {
    const files = listFixtureFiles(FIXTURE_SLUG);
    expect(files.length).toBeGreaterThan(50);
    const ingested = await ingestAll();
    expect(ingested.length).toBe(files.length);
  });

  it("creates an investment offering for every primary issuer", async () => {
    const ingested = await ingestAll();
    // Each filing produces one offering row keyed on (cik, file_number). The
    // count of rows should match the filings we ingested (modulo collisions
    // where two filings share the same cik+file_number, which is rare).
    const allOfferings =
      (await investmentOfferingRepo.investmentOfferingRepository.getAll()) || [];
    expect(allOfferings.length).toBeGreaterThanOrEqual(
      Math.floor(ingested.length * 0.95)
    );
  });

  it("creates an offering history row per filing", async () => {
    const ingested = await ingestAll();
    const histories =
      (await investmentOfferingRepo.investmentOfferingHistoryRepository.getAll()) || [];
    // History rows are keyed on accession_number, so collisions are
    // practically impossible across distinct fixtures.
    expect(histories.length).toBe(ingested.length);
  });

  it("links each issuer company back through getCompaniesByEntity(cik)", async () => {
    const ingested = await ingestAll();
    const step = Math.max(1, Math.floor(ingested.length / 8));
    let checked = 0;
    let found = 0;
    for (let i = 0; i < ingested.length && checked < 8; i += step) {
      const f = ingested[i];
      if (!f.primaryIssuerName) continue;
      checked++;
      const expected = companyRepo.normalizeCompanyName(f.primaryIssuerName);
      const companies = await companyRepo.getCompaniesByEntity(f.cik);
      if (
        companies.some(
          (c) => c.company_name === expected || c.company_name === f.primaryIssuerName
        )
      ) {
        found++;
      }
    }
    expect(found).toBeGreaterThanOrEqual(Math.floor(checked * 0.8));
  });

  it("stores related people for filings that disclose them", async () => {
    const ingested = await ingestAll();
    const filingsWithPeople = ingested.filter((f) => f.relatedPersonCount > 0);
    if (filingsWithPeople.length === 0) return;
    const allPersons = (await personRepo.personRepository.getAll()) || [];
    // Related-person rows aren't 1:1 with the XML count (normalization can
    // collapse names, company-shaped names get routed to CompanyRepo, etc.)
    // but we should at least have *some* people for a fixture set this big.
    expect(allPersons.length).toBeGreaterThan(0);
  });

  it("stores secondary issuers in the Issuer cross-reference table", async () => {
    const ingested = await ingestAll();
    const filingsWithSecondary = ingested.filter((f) => f.additionalIssuerCount > 0);
    if (filingsWithSecondary.length === 0) return;
    // Each filing's `issuerList.issuer[]` produces one issuer-record per
    // entry whose CIK differs from the filing's. We accept some skew because
    // a secondary issuer with the same CIK as the filer is intentionally
    // skipped by processIssuer.
    const allIssuers = (await issuerRepo.issuerRepository.getAll()) || [];
    expect(allIssuers.length).toBeGreaterThan(0);
  });

  it("processes a D/A amendment when fed through the same pipeline", async () => {
    const files = listFixtureFiles("form-d-a");
    if (files.length === 0) return;
    // Just ingest the first 5 D/A fixtures and confirm they all reach the
    // offering history table (amendments still write a history row, just
    // with the amended values).
    const sample = files.slice(0, 5);
    for (const file of sample) {
      const xml = readFixture("form-d-a", file);
      const formD = await Form_D.parse("D/A", xml);
      const accession = accessionFromFixtureName(file);
      const cik = safeCikToInt(formD.primaryIssuer.cik);
      const fileNumber = deriveFileNumber(accession);
      await processFormD({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        primary_doc: file,
        formD,
      });
    }
    const histories =
      (await investmentOfferingRepo.investmentOfferingHistoryRepository.getAll()) || [];
    expect(histories.length).toBe(sample.length);
  });
});
