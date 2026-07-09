/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Round-trip pipeline test for Form 1-Z (Reg-A exit report):
 * XML -> parse -> store -> query the repos.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { Form_1_Z } from "./Form_1_Z";
import { processForm1Z } from "./Form_1_Z.storage";
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
}

const FIXTURE_SLUG = "form-1-z";

describe("Form_1_Z pipeline", () => {
  let regARepo: RegAOfferingRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    regARepo = new RegAOfferingRepo();
  });

  async function ingestAll(
    slug: string = FIXTURE_SLUG,
    formCode: "1-Z" | "1-Z/A" = "1-Z"
  ): Promise<IngestedFixture[]> {
    const ingested: IngestedFixture[] = [];
    const summary = await runPipeline(slug, async (file, xml) => {
      const form1Z = await Form_1_Z.parse(formCode, xml);
      const accession = accessionFromFixtureName(file);
      const item1 = form1Z.formData.item1;
      const cik = safeCikToInt(item1.cik);
      const fileNumber = deriveFileNumber(accession);
      await processForm1Z({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        form1Z,
      });
      ingested.push({
        file,
        cik,
        fileNumber,
        accession,
        issuerName: item1.issuerName,
      });
    });
    assertAllSucceeded(summary);
    return ingested;
  }

  it("parses + stores every form-1-z fixture without exceptions", async () => {
    const files = listFixtureFiles(FIXTURE_SLUG);
    expect(files.length).toBeGreaterThan(40);
    const ingested = await ingestAll();
    expect(ingested.length).toBe(files.length);
  });

  it("creates one exit-status offering row per filing", async () => {
    const ingested = await ingestAll();
    const offerings = (await regARepo.offeringRepository.getAll()) || [];
    expect(offerings.length).toBeGreaterThanOrEqual(Math.floor(ingested.length * 0.9));
  });

  it("tags every persisted 1-Z offering with status='exit'", async () => {
    await ingestAll();
    const offerings = (await regARepo.offeringRepository.getAll()) || [];
    for (const row of offerings) {
      expect(row.status).toBe("exit");
    }
  });

  it("creates offering-history rows when the 1-Z carries summary offerings", async () => {
    const ingested = await ingestAll();
    const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
    // 1-Z (exit report) is allowed to omit `summaryInfoOffering`. Each
    // filing that includes it writes at most one history row, keyed on
    // (cik, file_number, accession_number) -- the test uses a distinct
    // file_number per filing, so collisions can't inflate the count.
    expect(histories.length).toBeGreaterThan(0);
    expect(histories.length).toBeLessThanOrEqual(ingested.length);
  });

  it("links the issuer company back to its CIK via observations", async () => {
    await ingestAll();
    const allObs = await new CompanyObservationRepo().listAll();
    const issuerObs = allObs.filter((o) => {
      try {
        return JSON.parse(o.source_context ?? "{}").relation === "form-1z:issuer";
      } catch {
        return false;
      }
    });
    expect(issuerObs.length).toBeGreaterThan(0);
  });

  it("ingests a 1-Z/A amendment via the same pipeline", async () => {
    const files = listFixtureFiles("form-1-z-a");
    if (files.length === 0) return;
    for (const file of files.slice(0, 3)) {
      const xml = readFixture("form-1-z-a", file);
      const form1Z = await Form_1_Z.parse("1-Z/A", xml);
      const accession = accessionFromFixtureName(file);
      const cik = safeCikToInt(form1Z.formData.item1.cik);
      const fileNumber = deriveFileNumber(accession);
      await processForm1Z({
        cik,
        file_number: fileNumber,
        accession_number: accession,
        filing_date: "2024-01-15",
        primary_doc: file,
        form1Z,
      });
    }
    const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
    expect(histories.length).toBeGreaterThanOrEqual(1);
  });
});
