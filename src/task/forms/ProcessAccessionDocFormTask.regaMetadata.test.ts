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
import { REGA_CURRENT_REPORT_REPOSITORY_TOKEN } from "../../storage/reg-a/RegACurrentReportSchema";
import { REGA_OFFERING_EVENT_REPOSITORY_TOKEN } from "../../storage/reg-a/RegAOfferingEventSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

const CIK = 1725033;

class MustNotFetchTask extends ProcessAccessionDocFormTask {
  protected override async runFetch(): Promise<string> {
    throw new Error("fetch should not run for a metadata-only extractor");
  }
}

async function seedFiling(opts: {
  readonly accession: string;
  readonly form: string;
  readonly fileNumber?: string;
  readonly items?: string | null;
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: opts.accession,
    form: opts.form,
    // A real body exists for all three of these forms — the point is that the
    // driver never asks for it, not that there is nothing to ask for.
    primary_doc: "primary.htm",
    file_number: opts.fileNumber ?? "024-11234",
    filing_date: "2026-02-11",
    acceptance_date: "2026-02-11T00:00:00.000Z",
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: opts.items ?? null,
    act: null,
  } as never);
}

async function successfulRun(accession: string, extractorId: string): Promise<boolean> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  const run = await runRepo.findRun(CIK, accession, extractorId, "1.0.0");
  return run?.success === true && run?.outcome === "success";
}

/**
 * The three metadata-only extractors that carry no `MustNotFetchTask` suite of
 * their own. A recorded successful run is what stops a filing being re-selected
 * by the next sweep, so an extractor that stores but records nothing is
 * reprocessed forever — and one that fetches costs the download the whole
 * metadata-only path exists to avoid.
 */
describe("ProcessAccessionDocFormTask metadata-only Reg A forms", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("records a 253G supplement without fetching", async () => {
    const accession = "0001725033-26-000010";
    await seedFiling({ accession, form: "253G2" });

    const result = await new MustNotFetchTask().run({ accessionNumber: accession });
    expect((result as { success: boolean }).success).toBe(true);
    expect(await successfulRun(accession, "253G")).toBe(true);
    expect(await new ExtractionDeadLetterRepo().get("253G", accession, "")).toBeUndefined();

    const events = await globalServiceRegistry
      .get(REGA_OFFERING_EVENT_REPOSITORY_TOKEN)
      .query({ cik: CIK, accession_number: accession });
    expect(events?.[0]?.form).toBe("253G2");
    expect(events?.[0]?.file_number).toBe("024-11234");
  });

  it("records a 1-A-W withdrawal without fetching", async () => {
    const accession = "0001725033-26-000011";
    // EDGAR records no file number for this one, which the driver carries as ""
    // and the offering-event row must store as null rather than an empty string.
    await seedFiling({ accession, form: "1-A-W", fileNumber: "" });

    const result = await new MustNotFetchTask().run({ accessionNumber: accession });
    expect((result as { success: boolean }).success).toBe(true);
    expect(await successfulRun(accession, "1-A-W")).toBe(true);
    expect(await new ExtractionDeadLetterRepo().get("1-A-W", accession, "")).toBeUndefined();

    const events = await globalServiceRegistry
      .get(REGA_OFFERING_EVENT_REPOSITORY_TOKEN)
      .query({ cik: CIK, accession_number: accession });
    expect(events?.[0]?.form).toBe("1-A-W");
    expect(events?.[0]?.file_number).toBeNull();
  });

  it("records a 1-U current report, with its items, without fetching", async () => {
    const accession = "0001725033-26-000012";
    await seedFiling({ accession, form: "1-U", items: "9.01" });

    const result = await new MustNotFetchTask().run({ accessionNumber: accession });
    expect((result as { success: boolean }).success).toBe(true);
    expect(await successfulRun(accession, "1-U")).toBe(true);
    expect(await new ExtractionDeadLetterRepo().get("1-U", accession, "")).toBeUndefined();

    const reports = await globalServiceRegistry
      .get(REGA_CURRENT_REPORT_REPOSITORY_TOKEN)
      .query({ cik: CIK, accession_number: accession });
    expect(reports?.[0]?.form).toBe("1-U");
    expect(reports?.[0]?.items).toBe("9.01");
  });
});
