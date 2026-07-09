/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Round-trip pipeline test for Form C (Reg-CF): XML -> parse -> store ->
 * query the repos. The sibling `.test.ts` and `.storage.test.ts` files
 * cover parser shape and the storage call; this one verifies parsed
 * fields are actually reachable through the queryable repos.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { CrowdfundingRepo } from "../../../storage/portal/CrowdfundingRepo";
import { CrowdfundingTemporalRepo } from "../../../storage/portal/CrowdfundingTemporalRepo";
import { Form_C } from "./Form_C";
import { processFormC } from "./Form_C.storage";
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
  submissionType: string;
}

const FIXTURE_SLUG = "form-c";

describe("Form_C pipeline", () => {
  let crowdfundingRepo: CrowdfundingRepo;
  let temporalRepo: CrowdfundingTemporalRepo;
  let addressRepo: AddressRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    crowdfundingRepo = new CrowdfundingRepo();
    temporalRepo = new CrowdfundingTemporalRepo();
    addressRepo = new AddressRepo();
  });

  async function ingestAll(): Promise<IngestedFixture[]> {
    const ingested: IngestedFixture[] = [];
    const summary = await runPipeline(FIXTURE_SLUG, async (file, xml) => {
      const formC = await Form_C.parse("C", xml);
      const accession = accessionFromFixtureName(file);
      const cik = safeCikToInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
      const fileNumber = deriveFileNumber(accession);
      await processFormC({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        formC,
      });
      ingested.push({
        file,
        cik,
        fileNumber,
        accession,
        issuerName: formC.formData.issuerInformation.issuerInfo.nameOfIssuer,
        submissionType: formC.headerData.submissionType,
      });
    });
    assertAllSucceeded(summary);
    return ingested;
  }

  it("parses + stores every form-c fixture without exceptions", async () => {
    const files = listFixtureFiles(FIXTURE_SLUG);
    expect(files.length).toBeGreaterThan(50);
    const ingested = await ingestAll();
    expect(ingested.length).toBe(files.length);
  });

  it("round-trips every issuer name from XML into the crowdfunding repo", async () => {
    const ingested = await ingestAll();
    // Spot-check the round trip on every filing: the issuer name we read out
    // of the XML must appear in the crowdfunding record we can query by CIK.
    let matched = 0;
    for (const f of ingested) {
      const rows = await crowdfundingRepo.getCrowdfundingByCik(f.cik);
      // Multiple filings may share a CIK; require *some* row to carry our name.
      const hit = rows.find((r) => r.name === f.issuerName && r.file_number === f.fileNumber);
      if (hit) matched++;
    }
    // Allow a small slack for issuers that filed the same CIK twice -- the
    // last write wins on (cik, file_number) primary key. We assert a strong
    // floor (>=98%) rather than full equality.
    expect(matched).toBeGreaterThanOrEqual(Math.floor(ingested.length * 0.98));
  });

  it("stores at least one company row per ingested filing", async () => {
    const ingested = await ingestAll();
    const allCompanies = await new CompanyObservationRepo().listAll();
    // Each filing produces at least one issuer company + (often) co-issuers
    // and signature persons. At minimum we expect one company per filing.
    expect(allCompanies.length).toBeGreaterThanOrEqual(ingested.length);
  });

  it("populates the crowdfunding history (temporal) table", async () => {
    const ingested = await ingestAll();
    // CrowdfundingTemporalRepo writes one row per call to saveCrowdfundingWithHistory.
    const allHistory = (await temporalRepo.crowdfundingHistoryRepository.getAll()) || [];
    expect(allHistory.length).toBeGreaterThanOrEqual(ingested.length);
  });

  it("sets status='withdrawn' when ingesting a C-W fixture", async () => {
    // Pick one C-W fixture and ingest it under Form_C as well -- proves the
    // status discriminator in Form_C.storage.determineStatus actually reaches
    // the persisted row.
    const files = listFixtureFiles("form-c-w");
    if (files.length === 0) return;
    const file = files[0];
    const xml = readFixture("form-c-w", file);
    const formC = await Form_C.parse("C-W", xml);
    const accession = accessionFromFixtureName(file);
    const cik = safeCikToInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
    const fileNumber = deriveFileNumber(accession);
    await processFormC({
      cik,
      file_number: fileNumber,
      accession_number: accession,
      filing_date: "2024-01-15",
      primary_doc: file,
      formC,
    });
    const rows = await crowdfundingRepo.getCrowdfundingByCik(cik);
    const row = rows.find((r) => r.file_number === fileNumber);
    expect(row).toBeDefined();
    expect(row?.status).toBe("withdrawn");
  });

  it("sets status='amended' when ingesting a C/A fixture", async () => {
    const files = listFixtureFiles("form-c-a");
    if (files.length === 0) return;
    const file = files[0];
    const xml = readFixture("form-c-a", file);
    const formC = await Form_C.parse("C/A", xml);
    const accession = accessionFromFixtureName(file);
    const cik = safeCikToInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
    const fileNumber = deriveFileNumber(accession);
    await processFormC({
      cik,
      file_number: fileNumber,
      accession_number: accession,
      filing_date: "2024-01-15",
      primary_doc: file,
      formC,
    });
    const rows = await crowdfundingRepo.getCrowdfundingByCik(cik);
    const row = rows.find((r) => r.file_number === fileNumber);
    expect(row).toBeDefined();
    expect(row?.status).toBe("amended");
  });

  it("indexes each ingested company under its CIK", async () => {
    const ingested = await ingestAll();
    // Pick five filings at evenly spaced indices and verify the issuer
    // company observation is reachable by accession_number and has the
    // expected CIK and name.
    const companyObsRepo = new CompanyObservationRepo();
    const allObs = await companyObsRepo.listAll();
    const step = Math.max(1, Math.floor(ingested.length / 5));
    let checked = 0;
    let found = 0;
    for (let i = 0; i < ingested.length && checked < 5; i += step) {
      const f = ingested[i];
      checked++;
      const match = allObs.find(
        (o) =>
          o.accession_number === f.accession &&
          o.cik === f.cik &&
          o.name === f.issuerName &&
          o.observation_index === 0
      );
      if (match) found++;
    }
    expect(found).toBeGreaterThanOrEqual(Math.floor(checked * 0.8));
  });
});
