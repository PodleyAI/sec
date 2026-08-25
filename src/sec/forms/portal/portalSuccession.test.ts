/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../../storage/filing/FilingSchema";
import { PortalRepo } from "../../../storage/portal/PortalRepo";
import { PORTAL_SUCCESSION_REPOSITORY_TOKEN } from "../../../storage/portal/PortalSuccessionSchema";
import {
  buildPortalFileNumberIndex,
  normalizePortalFileNumber,
} from "../../../storage/portal/portalFileNumberIndex";
import { Form_CFPORTAL } from "./Form_CFPORTAL";
import { processFormCFPORTAL } from "./Form_CFPORTAL.storage";

const FIXTURE_DIR = join(__dirname, "mock_data", "cfportal");

/** OpenDeal Portal LLC's original 2018 registration — the one carrying the claim. */
const REPUBLIC_SUCCESSOR_FIXTURE = "000175152518000001-primary_doc.xml";
const SUCCESSOR_CIK = 1751525;
const PREDECESSOR_CIK = 1672732;

async function seedFiling(cik: number, accession: string, file_number: string): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    accession_number: accession,
    cik,
    form: "CFPORTAL",
    filing_date: "2016-04-25",
    report_date: null,
    acceptance_date: "2016-04-25T00:00:00.000Z",
    file_number,
    film_number: null,
    primary_doc: "primary_doc.xml",
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  });
}

async function processFixture(file: string, cik: number, accession: string, date: string) {
  const xml = readFileSync(join(FIXTURE_DIR, file), "utf-8");
  const parsed = await Form_CFPORTAL.parse("CFPORTAL", xml);
  await processFormCFPORTAL({
    cik,
    accession_number: accession,
    filing_date: date,
    formCfportal: parsed,
  });
}

describe("normalizePortalFileNumber", () => {
  it("reduces the spellings filers actually use to one key", () => {
    const canonical = normalizePortalFileNumber("007-00046");
    expect(normalizePortalFileNumber("7-00046")).toBe(canonical);
    expect(normalizePortalFileNumber(" 007-0046 ")).toBe(canonical);
    expect(normalizePortalFileNumber("007-000012")).toBe(normalizePortalFileNumber("7-00012"));
  });

  it("refuses a value that is not a file number rather than matching loosely", () => {
    // A bare prefix must not resolve: it would match every portal at once.
    expect(normalizePortalFileNumber("7")).toBeUndefined();
    expect(normalizePortalFileNumber("")).toBeUndefined();
    expect(normalizePortalFileNumber(null)).toBeUndefined();
  });
});

describe("portal succession", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("drops a file number two filers share instead of picking one", async () => {
    await seedFiling(111, "0000000111-16-000001", "007-00099");
    await seedFiling(222, "0000000222-16-000001", "007-00099");
    await seedFiling(333, "0000000333-16-000001", "007-00100");
    const index = await buildPortalFileNumberIndex();
    expect(index.has(normalizePortalFileNumber("007-00099")!)).toBe(false);
    expect(index.get(normalizePortalFileNumber("007-00100")!)).toBe(333);
  });

  it("records the claim and points the predecessor at its successor", async () => {
    const portalRepo = new PortalRepo();
    // OpenDeal Inc. as it stands before the handover: registered, never
    // withdrawn, which is exactly why `live` cannot express that it stopped.
    await portalRepo.savePortal({
      cik: PREDECESSOR_CIK,
      name: "OpenDeal Inc.",
      brand: "Republic",
      url: "www.republic.co",
      live: true,
      as_of: "2018-12-11",
    });
    await seedFiling(PREDECESSOR_CIK, "0001672732-16-000001", "007-00046");

    await processFixture(
      REPUBLIC_SUCCESSOR_FIXTURE,
      SUCCESSOR_CIK,
      "0001751525-18-000001",
      "2018-09-04"
    );

    const rows =
      (await globalServiceRegistry.get(PORTAL_SUCCESSION_REPOSITORY_TOKEN).getAll()) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      cik: SUCCESSOR_CIK,
      detail_index: 0,
      predecessor_name: "OpenDeal Inc.",
      predecessor_file_number: "007-00046",
      predecessor_cik: PREDECESSOR_CIK,
      filing_date: "2018-09-04",
    });
    expect(rows[0]!.detail).toContain("internal reorganization");

    // The pointer goes on the PREDECESSOR, forward to the surviving filer.
    const predecessor = await portalRepo.getPortal(PREDECESSOR_CIK);
    expect(predecessor?.succeeded_by_cik).toBe(SUCCESSOR_CIK);
    const successor = await portalRepo.getPortal(SUCCESSOR_CIK);
    expect(successor?.succeeded_by_cik ?? null).toBeNull();
  });

  it("keeps the claim but sets no pointer when the file number does not resolve", async () => {
    // No filing seeded for 007-00046, so the index cannot resolve it. The claim
    // is still the filer's statement and is recorded; guessing from the name is
    // what the null exists to avoid.
    await processFixture(
      REPUBLIC_SUCCESSOR_FIXTURE,
      SUCCESSOR_CIK,
      "0001751525-18-000001",
      "2018-09-04"
    );

    const rows =
      (await globalServiceRegistry.get(PORTAL_SUCCESSION_REPOSITORY_TOKEN).getAll()) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      predecessor_name: "OpenDeal Inc.",
      predecessor_file_number: "007-00046",
      predecessor_cik: null,
    });
  });

  it("does not retire a filer whose succession names its own file number", async () => {
    // Three of the four `Y` answers in the whole universe are this: a rename
    // EDGAR handled by keeping the CIK. It produces no duplicate registration,
    // so it must not set a pointer.
    await seedFiling(SUCCESSOR_CIK, "0001751525-18-000001", "007-00046");
    const portalRepo = new PortalRepo();

    await processFixture(
      REPUBLIC_SUCCESSOR_FIXTURE,
      SUCCESSOR_CIK,
      "0001751525-18-000001",
      "2018-09-04"
    );

    const rows =
      (await globalServiceRegistry.get(PORTAL_SUCCESSION_REPOSITORY_TOKEN).getAll()) ?? [];
    expect(rows[0]?.predecessor_cik).toBe(SUCCESSOR_CIK);
    const self = await portalRepo.getPortal(SUCCESSOR_CIK);
    expect(self?.succeeded_by_cik ?? null).toBeNull();
  });

  it("records nothing for a filing that answers N", async () => {
    await processFixture(
      "000166919116000001-primary_doc.xml",
      1669191,
      "0001669191-16-000001",
      "2016-05-01"
    );
    const rows =
      (await globalServiceRegistry.get(PORTAL_SUCCESSION_REPOSITORY_TOKEN).getAll()) ?? [];
    expect(rows).toHaveLength(0);
  });
});
