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

const CIK = 1848507;
const ACCESSION = "0001193125-22-001518";

class MustNotFetchTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(): Promise<string> {
    throw new Error("fetch should not run for extractor RW");
  }
}

async function seedFiling(primaryDoc: string | null): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: ACCESSION,
    form: "RW",
    primary_doc: primaryDoc,
    file_number: "",
    filing_date: "2022-01-04",
    acceptance_date: "2022-01-04T00:00:00.000Z",
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
    accession_number: "0001193125-21-047764",
    filing_date: "2021-02-16",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "1.12 Acquisition Corp",
    spac_sic: 6770,
  });
}

describe("ProcessAccessionDocFormTask metadata-only Form RW", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("succeeds for RW with no primary document and never fetches", async () => {
    await seedSpac();
    await seedFiling(null);

    const result = await new MustNotFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(true);

    const dl = await new ExtractionDeadLetterRepo().get("RW", ACCESSION, "");
    expect(dl).toBeUndefined();

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "RW", "1.0.0");
    expect(run?.success).toBe(true);
    expect(run?.outcome).toBe("success");

    const events = await new SpacRepo().getEvents(CIK);
    expect(events.filter((e) => e.event_type === "withdrawal")).toHaveLength(1);
    const row = await new SpacRepo().getSpac(CIK);
    expect(row?.status).toBe("withdrawn");
  });

  it("records a successful no-op run when the issuer has no SPAC row", async () => {
    await seedFiling(null);

    const result = await new MustNotFetchTask().run({ accessionNumber: ACCESSION });
    expect((result as { success: boolean }).success).toBe(true);

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(CIK, ACCESSION, "RW", "1.0.0");
    expect(run?.success).toBe(true);

    expect(await new SpacRepo().getEvents(CIK)).toEqual([]);
  });
});
