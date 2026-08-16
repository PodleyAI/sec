/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const CIK = 1822912;
const EXCHANGE_CIK = 876661;
const ACCESSION = "0001354457-23-000698";
const NEAR_IPO_ACCESSION = "0000876661-26-000550";

class MustNotFetchTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(): Promise<string> {
    throw new Error("fetch should not run for extractor 25-15");
  }
}

async function seedFiling(
  primaryDoc: string | null,
  opts: { cik?: number; accession?: string; filingDate?: string } = {}
): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: opts.cik ?? CIK,
    accession_number: opts.accession ?? ACCESSION,
    form: "25-NSE",
    primary_doc: primaryDoc,
    file_number: "",
    filing_date: opts.filingDate ?? "2023-09-25",
    acceptance_date: "2023-09-25T00:00:00.000Z",
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  } as never);
}

async function seedSpac(): Promise<void> {
  await new SpacReportWriter().recordRegistration({
    cik: CIK,
    accession_number: "0001213900-20-027882",
    filing_date: "2020-09-23",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "26 Capital Acquisition Corp",
    spac_sic: 6770,
  });
}

describe("ProcessAccessionDocFormTask metadata-only Form 25/15", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("succeeds for 25-NSE with no primary document and never fetches", async () => {
    await seedSpac();
    await seedFiling(null);

    const result = await new MustNotFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(true);

    const dl = await new ExtractionDeadLetterRepo().get("25-15", ACCESSION, "");
    expect(dl).toBeUndefined();

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "25-15", "1.0.0");
    expect(run?.success).toBe(true);
    expect(run?.outcome).toBe("success");

    const events = await new SpacRepo().getEvents(CIK);
    expect(events.filter((e) => e.event_type === "deregistration")).toHaveLength(1);
    const row = await new SpacRepo().getSpac(CIK);
    expect(row?.status).toBe("liquidated");
    expect(row?.failed_date).toBe("2023-09-25");
  });

  it("records a successful no-op run when the issuer has no SPAC row", async () => {
    await seedFiling(null);

    const result = await new MustNotFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(true);

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "25-15", "1.0.0");
    expect(run?.success).toBe(true);

    expect(await new SpacRepo().getEvents(CIK)).toEqual([]);
  });

  it("uses the issuer CIK when the same 25-NSE accession is also stored under the exchange", async () => {
    await seedSpac();
    await new SpacReportWriter().recordIpo({
      cik: CIK,
      accession_number: "0001213900-21-000001",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["FOO.U"],
    });
    await seedFiling(null, {
      cik: EXCHANGE_CIK,
      accession: NEAR_IPO_ACCESSION,
      filingDate: "2021-03-01",
    });
    await seedFiling(null, {
      cik: CIK,
      accession: NEAR_IPO_ACCESSION,
      filingDate: "2021-03-01",
    });

    const result = await new MustNotFetchTask().run({
      accessionNumber: NEAR_IPO_ACCESSION,
      cik: CIK,
    });
    expect((result as { success: boolean }).success).toBe(true);

    const events = await new SpacRepo().getEvents(CIK);
    expect(events.filter((e) => e.event_type === "unit_split")).toHaveLength(1);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect((await new SpacRepo().getSpac(CIK))?.status).toBe("searching");
  });
});
