/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_DRY_RUN, SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { ProcessAccessionDocFormTask } from "../forms/ProcessAccessionDocFormTask";
import { ProcessSpacTimelineTask } from "./ProcessSpacTimelineTask";

const CIK = 1800001;

const GOOD_FORM_D = readFileSync(
  path.join(
    __dirname,
    "../../sec/forms/exempt-offerings/mock_data/form-d/000192959422000001-primary_doc.xml"
  ),
  "utf-8"
);

/**
 * Seeds one filing. `primaryDoc` null is the no-primary-document case, which
 * dead-letters PRIMARY_DOC_UNRESOLVED and reports `success: false` without
 * touching the network.
 */
async function seedFiling(
  accession: string,
  form: string,
  filingDate: string,
  primaryDoc: string | null = null
): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: CIK,
    accession_number: accession,
    form,
    primary_doc: primaryDoc,
    file_number: "333-1",
    filing_date: filingDate,
    acceptance_date: `${filingDate}T00:00:00.000Z`,
    report_date: null,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  });
}

/**
 * Writes a filing's document into the on-disk accession-doc cache, so the
 * replay's fetch stage is served from disk and the filing processes for real
 * with no network. Mirrors `SecFetchAccessionDocTask.inputToFileName`:
 * `accessiondocs/<0-padded cik>/<accession w/o dashes>-<fileName>`.
 */
function cacheDoc(accession: string, fileName: string, body: string): void {
  const dir = path.join(rawRoot!, "accessiondocs", String(CIK).padStart(10, "0"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${accession.replace(/-/g, "")}-${fileName}`), body);
}

let rawRoot: string | undefined;

describe("ProcessSpacTimelineTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-spac-timeline-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
  });

  afterEach(() => {
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    vi.restoreAllMocks();
    resetDependencyInjectionsForTesting();
  });

  it("counts only filings that actually succeeded, not the whole timeline", async () => {
    // `ProcessAccessionDocFormTask` contains its own failures and reports them
    // on a `success` port rather than throwing, so returning `timeline.length`
    // as `processed` printed "2/2 filings" for an issuer whose every filing
    // dead-lettered. The operator's one summary line said the replay worked.
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(2);
    expect(out.processed).toBe(0);
    expect(out.failed).toBe(2);
    expect(out.partial).toBe(0);
    expect(out.cik).toBe(CIK);
    expect(out.error).toBe("");
    expect(out.firstDate).toBe("2021-01-04");
    expect(out.lastDate).toBe("2021-02-04");
  });

  it("counts a filing that did succeed, so the count is not merely always zero", async () => {
    // The all-failing case above passes just as well against a `processed` that
    // is hard-wired to 0, or against a `success` column read under the wrong
    // shape. Only a real success separates "counts what succeeded" from
    // "counts nothing" — so process one filing for real off the on-disk cache
    // and one with no primary document, and require the count to land at 1.
    await seedFiling("0000000000-26-000001", "D", "2021-01-04", "primary_doc.xml");
    cacheDoc("0000000000-26-000001", "primary_doc.xml", GOOD_FORM_D);
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(2);
    expect(out.processed).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.partial).toBe(0);
    expect(out.error).toBe("");
  });

  it("reports an issuer-level failure on the error port instead of throwing", async () => {
    // The isolation the batch depends on. Thrown from a task, this reached the
    // CLI workflow renderer, which answers a thrown error with
    // `process.exit(1)` — killing the whole batch on one bad issuer, which is
    // precisely what running issuers independently was meant to prevent.
    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    vi.spyOn(repo, "query").mockRejectedValue(new Error("filing store unavailable"));

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.cik).toBe(CIK);
    expect(out.error).toContain("filing store unavailable");
    expect(out.matched).toBe(0);
    expect(out.processed).toBe(0);
  });

  it("counts a store-completed filing whose sections dead-lettered as partial, not processed", async () => {
    // ProcessAccessionDocFormTask returns `{ success: true }` when store did
    // not throw, even if a section dead-lettered and extractor_runs recorded
    // `outcome: "partial"`. Counting that boolean printed "52/52 filings" for
    // a CIK whose DRS/S-1 underwriters section came back MODEL_EMPTY.
    await seedFiling("0000000000-26-000001", "D", "2021-01-04", "primary_doc.xml");

    const proto = ProcessAccessionDocFormTask.prototype;
    const real = proto.execute;
    proto.execute = async (input) => {
      const runRepo = new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      );
      await runRepo.recordRun({
        cik: CIK,
        accession_number: input.accessionNumber!,
        form: "D",
        extractor_id: "D",
        extractor_version: "1.0.0",
        slot_at_run: "current",
        success: false,
        outcome: "partial",
        error: null,
      });
      await new ExtractionDeadLetterRepo().record({
        extractor_id: "D",
        accession_number: input.accessionNumber!,
        section_name: "underwriters",
        reason_code: "MODEL_EMPTY",
        detail: "no underwriters returned",
        failed_extractor_version: "1.0.0",
        source_run_id: null,
      });
      return { success: true };
    };

    try {
      const out = await new ProcessSpacTimelineTask().run({ cik: CIK });
      expect(out.matched).toBe(1);
      expect(out.processed).toBe(0);
      expect(out.partial).toBe(1);
      expect(out.failed).toBe(0);
      expect(out.triage).toBe(1);
      expect(out.triageExtractors).toBe("D");
      expect(out.error).toBe("");
    } finally {
      proto.execute = real;
    }
  });

  it("names every extractor that wrote a pending dead-letter, including 8-K sub-extractors", async () => {
    // The inspect hint is `sec extractor dead-letters <id>`, and an 8-K can
    // dead-letter under `redemption` / `loi` as well as `8-K`. Counting triage
    // without naming those ids left the operator with a placeholder.
    await seedFiling("0000000000-26-000001", "8-K", "2021-01-04", "d8k.htm");

    const proto = ProcessAccessionDocFormTask.prototype;
    const real = proto.execute;
    proto.execute = async (input) => {
      const runRepo = new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      );
      await runRepo.recordRun({
        cik: CIK,
        accession_number: input.accessionNumber!,
        form: "8-K",
        extractor_id: "8-K",
        extractor_version: "1.0.0",
        slot_at_run: "current",
        success: false,
        outcome: "partial",
        error: null,
      });
      const deadLetters = new ExtractionDeadLetterRepo();
      await deadLetters.record({
        extractor_id: "redemption",
        accession_number: input.accessionNumber!,
        section_name: "redemption",
        reason_code: "MODEL_EMPTY",
        detail: null,
        failed_extractor_version: "1.0.0",
        source_run_id: null,
      });
      await deadLetters.record({
        extractor_id: "loi",
        accession_number: input.accessionNumber!,
        section_name: "loi",
        reason_code: "MODEL_EMPTY",
        detail: null,
        failed_extractor_version: "1.0.0",
        source_run_id: null,
      });
      return { success: true };
    };

    try {
      const out = await new ProcessSpacTimelineTask().run({ cik: CIK });
      expect(out.partial).toBe(1);
      expect(out.triage).toBe(2);
      expect(out.triageExtractors).toBe("loi,redemption");
    } finally {
      proto.execute = real;
    }
  });

  it("dry-run reports the timeline without reprocessing filings", async () => {
    // `--dry-run` wraps storage as read-only, but the replay still ran every
    // filing — including a live model.info verify that hangs the CLI, and
    // outcome counts read back from extractor_runs writes that never landed,
    // so a 52-filing issuer printed as 0/52 failed. Count the timeline; do
    // not call the form processor.
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    await seedFiling("0000000000-26-000001", "D", "2021-01-04", "primary_doc.xml");
    cacheDoc("0000000000-26-000001", "primary_doc.xml", GOOD_FORM_D);
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).not.toHaveBeenCalled();
    expect(out.matched).toBe(2);
    expect(out.processed).toBe(0);
    expect(out.failed).toBe(0);
    expect(out.partial).toBe(0);
    expect(out.firstDate).toBe("2021-01-04");
    expect(out.lastDate).toBe("2021-02-04");
    expect(out.error).toBe("");
  });

  it("echoes the cik so a fan-out's result columns are self-labelling", async () => {
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });
    // No filings at all is still an answer about THIS issuer.
    expect(out).toMatchObject({
      cik: CIK,
      matched: 0,
      processed: 0,
      partial: 0,
      failed: 0,
      error: "",
    });
  });
});
