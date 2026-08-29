/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SEC_DRY_RUN, SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { registerFormExtractor } from "../../sec/forms/formExtractors";
import { PARSER_ONLY_FORMS_BY_EXTRACTOR } from "../../sec/forms/parserOnlyForms";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../storage/spac/SpacCandidateSchema";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ProcessAccessionDocFormTask } from "../forms/ProcessAccessionDocFormTask";
import { MAX_RETAINED_FILING_ROWS, ProcessSpacTimelineTask } from "./ProcessSpacTimelineTask";

const CIK = 1800001;
const S4 = "S-4";

const noopStore = async (): Promise<void> => {};

/**
 * A de-SPAC `S-4` is a registration statement AND the merger proxy for the same
 * vote, so one form carries two extractors — and `S-4` is deliberately a symbol
 * the shipped 1:1 map has no entry for at all.
 */
beforeAll(() => {
  registerFormExtractor({ id: "S-4", forms: [S4], store: noopStore });
  // A second registry key under an EXISTING id, so the shipped `merger-proxy`
  // registration is widened rather than replaced.
  registerFormExtractor({ id: "merger-proxy", section: "de-spac", forms: [S4], store: noopStore });
  // The two readings whose known-SPAC gate this task exists to repair are a
  // consumer's now: the 8-K's de-SPAC milestones under `8-K` (this package
  // keeps only the item codes, under `8-K-items`, which is not gated at all)
  // and the listing removals under `25-15`. Stand-ins over exactly the forms
  // each is registered for keep the repair reachable here.
  registerFormExtractor({ id: "8-K", forms: ["8-K", "8-K/A"], store: noopStore });
  registerFormExtractor({
    id: "25-15",
    forms: PARSER_ONLY_FORMS_BY_EXTRACTOR["25-15"],
    needsDocument: false,
    store: noopStore,
  });
});

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
  primaryDoc: string | null = null,
  items: string | null = null
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
    items,
    act: null,
  });
}

async function seedSpacCandidate(): Promise<void> {
  await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put({
    cik: CIK,
    name: "Screened Acquisition Corp",
    current_sic: 6770,
    signal_sic_6770: true,
    signal_name_match: true,
    signal_renamed_from: null,
    first_reg_form: "S-1",
    first_reg_date: "2020-11-01",
    reg_while_spac_named: true,
    confidence: "high",
    identified_at: "2026-01-01T00:00:00.000Z",
    signal_filed_sic_6770: null,
  });
}

async function seedSuccessfulRun(
  accession: string,
  form: string,
  extractor_id: string
): Promise<void> {
  const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  await repo.recordRun({
    cik: CIK,
    accession_number: accession,
    form,
    extractor_id,
    extractor_version: "1.0.0",
    slot_at_run: "current",
    success: true,
    error: null,
  });
}

/**
 * A successful run for EVERY extractor an 8-K carries: the item codes this
 * package records and the milestone reading a consumer registers. A filing is
 * only "already processed" once all of them have succeeded, so seeding one
 * would leave it selected for reasons this fixture is not about.
 */
async function seedSuccessfulEightKRun(accession: string): Promise<void> {
  await seedSuccessfulRun(accession, "8-K", "8-K-items");
  await seedSuccessfulRun(accession, "8-K", "8-K");
}

/** Gives an extractor id a `current` slot, as `db setup` does for the shipped ids. */
async function seedExtractorVersion(id: string): Promise<void> {
  await new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)).putSlot({
    component_kind: "extractor",
    component_id: id,
    slot: "current",
    semver: "1.0.0",
    bump_type: null,
    started_at: "2021-01-01T00:00:00.000Z",
    coverage_complete: true,
    target_count: null,
  });
}

/**
 * Records the merger extraction the `S-4`'s second extractor produces, so the
 * known-SPAC-gated repair pass has its artifact and leaves the filing alone —
 * which is what makes the already-succeeded skip the thing under test.
 */
async function seedMergerExtraction(accession: string): Promise<void> {
  await new SpacMergerExtractionRepo().save({
    accession_number: accession,
    cik: CIK,
    form: S4,
    filing_date: "2021-02-04",
    extractor_id: "merger-proxy",
    extractor_version: "1.0.0",
    target_name: "Acme",
    target_cik: null,
    target_observation_id: null,
    target_description: null,
    pipe_amount: null,
    equity_value: null,
    enterprise_value: null,
    merger_consideration: null,
    confidence: 0.9,
    source_span: null,
    seeks_combination_approval: null,
    model_id: null,
    created_at: new Date().toISOString(),
  });
}

async function seedIpoEvent(accession: string): Promise<void> {
  await new SpacRepo().saveEvent({
    cik: CIK,
    accession_number: accession,
    event_type: "ipo",
    event_date: "2021-01-15",
    form: "424B4",
    primary_document: null,
    source_document_url: null,
    deal_index: null,
    amount: null,
    shares: null,
    detail: null,
    confidence: null,
    created_at: new Date().toISOString(),
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

  it("does not count a Form 4 fetch miss as a fatal failed filing", async () => {
    // Ownership forms are off the SPAC timeline's critical path. A missing
    // Form 4 used to increment `failed` and fail the issuer's `spac process`
    // exit even when every S-1/424/8-K succeeded.
    await seedFiling("0000000000-26-000001", "D", "2021-01-04", "primary_doc.xml");
    cacheDoc("0000000000-26-000001", "primary_doc.xml", GOOD_FORM_D);
    await seedFiling("0000000000-26-000002", "4", "2021-02-04");

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(2);
    expect(out.processed).toBe(1);
    expect(out.failed).toBe(0);
    expect(out.nonfatal).toBe(1);
    expect(out.error).toBe("");
  });

  it("still counts a Form D failure as fatal when a Form 4 also failed", async () => {
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedFiling("0000000000-26-000002", "4", "2021-02-04");

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(2);
    expect(out.failed).toBe(1);
    expect(out.nonfatal).toBe(1);
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
    await new SpacReportWriter().recordRegistration({
      cik: CIK,
      accession_number: "0000000000-26-000000",
      filing_date: "2021-01-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Gated SPAC",
      spac_sic: 6770,
    });

    const proto = ProcessAccessionDocFormTask.prototype;
    const real = proto.execute;
    proto.execute = async (input) => {
      const runRepo = new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      );
      // The item-code half succeeds; the milestone reading is the one that
      // came back partial. A filing's outcome is worst-outcome-wins over every
      // extractor its form carries, so both rows have to exist for the rollup
      // to be about the failure rather than about a missing row.
      await runRepo.recordRun({
        cik: CIK,
        accession_number: input.accessionNumber!,
        form: "8-K",
        extractor_id: "8-K-items",
        extractor_version: "1.0.0",
        slot_at_run: "current",
        success: true,
        error: null,
      });
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
    expect(out.skipped).toBe(0);
    expect(out.firstDate).toBe("2021-01-04");
    expect(out.lastDate).toBe("2021-02-04");
    expect(out.error).toBe("");
  });

  it("skips a filing that already succeeded at the active version", async () => {
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");
    await seedSuccessfulRun("0000000000-26-000001", "D", "D");

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]?.accessionNumber).toBe("0000000000-26-000002");
    expect(out.matched).toBe(2);
    expect(out.skipped).toBe(1);
    expect(out.processed).toBe(1);
  });

  it("replays a gated 8-K whose success row wrote nothing, rather than skipping it", async () => {
    // The 8-K handler is gated on a `spac` row and records `success: true`
    // while writing nothing when the row does not exist yet — which is exactly
    // the state `spac process` exists to repair. Reading that row as "already
    // processed" made the repair command skip the only filings it was for.
    await new SpacReportWriter().recordRegistration({
      cik: CIK,
      accession_number: "0000000000-26-000001",
      filing_date: "2021-01-04",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Gated SPAC",
      spac_sic: 6770,
    });
    await seedFiling("0000000000-26-000002", "8-K", "2021-02-04", "d8k.htm", "5.07");
    await seedSuccessfulEightKRun("0000000000-26-000002");

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]?.accessionNumber).toBe("0000000000-26-000002");
    expect(out.skipped).toBe(0);
  });

  it("still skips a gated 8-K that carries no known-SPAC item code", async () => {
    // A 2.02 earnings 8-K writes nothing either way, so re-selecting it would
    // replay half the issuer's 8-Ks on every sweep forever.
    await new SpacReportWriter().recordRegistration({
      cik: CIK,
      accession_number: "0000000000-26-000001",
      filing_date: "2021-01-04",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Gated SPAC",
      spac_sic: 6770,
    });
    await seedFiling("0000000000-26-000002", "8-K", "2021-02-04", "d8k.htm", "2.02");
    await seedSuccessfulEightKRun("0000000000-26-000002");

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).not.toHaveBeenCalled();
    expect(out.skipped).toBe(1);
  });

  /**
   * Stands in for the real form pipeline: the S-1 mints the `spac` row, the
   * 8-K records its vote event, and both record a successful run at the active
   * version — the artifacts each selection predicate keys on. Installed as a
   * spy so `vi.restoreAllMocks()` in `afterEach` puts the real method back.
   */
  function mockFormProcessor() {
    return vi
      .spyOn(ProcessAccessionDocFormTask.prototype, "execute")
      .mockImplementation(async (input) => {
        const accession = input.accessionNumber!;
        const isRegistration = input.form === "S-1";
        if (isRegistration) {
          await new SpacReportWriter().recordRegistration({
            cik: CIK,
            accession_number: accession,
            filing_date: "2021-01-04",
            form: "S-1",
            primary_document: "s1.htm",
            spac_name: "Gated SPAC",
            spac_sic: 6770,
          });
        } else {
          await new SpacRepo().saveEvent({
            cik: CIK,
            accession_number: accession,
            event_type: "vote",
            event_date: "2021-02-04",
            form: "8-K",
            primary_document: null,
            source_document_url: null,
            deal_index: null,
            amount: null,
            shares: null,
            detail: null,
            confidence: null,
            created_at: new Date().toISOString(),
          });
        }
        // One row per extractor id the form carries, as a real dispatch
        // records: the 8-K's item codes and its milestone reading are separate
        // ids with separate ledgers.
        const runRepo = new ExtractorRunRepo(
          globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
        );
        for (const extractor_id of isRegistration ? ["S-1-xbrl"] : ["8-K-items", "8-K"]) {
          await runRepo.recordRun({
            cik: CIK,
            accession_number: accession,
            form: isRegistration ? "S-1" : "8-K",
            extractor_id,
            extractor_version: "1.0.0",
            slot_at_run: "current",
            success: true,
            error: null,
          });
        }
        return { success: true };
      });
  }

  /** An S-1 that will mint the row, and an 8-K already gated by its absence. */
  async function seedGatedTimeline(): Promise<void> {
    await seedFiling("0000000000-26-000001", "S-1", "2021-01-04", "s1.htm");
    await seedFiling("0000000000-26-000002", "8-K", "2021-02-04", "d8k.htm", "5.07");
    await seedSuccessfulEightKRun("0000000000-26-000002");
  }

  it("processes gated 8-Ks in the same run as the S-1 that mints the spac row", async () => {
    // The canonical broken state: 8-Ks swept before the registration statement.
    // The gated set is empty while the CIK has no `spac` row — and the S-1 that
    // mints it is on this very timeline, replayed moments after the set was
    // computed. Every gated 8-K was therefore filtered out of the one run that
    // could repair it, and only a second identical invocation fixed it, with
    // nothing anywhere saying so.
    await seedGatedTimeline();
    const spy = mockFormProcessor();

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    const accessions = spy.mock.calls.map((c) => c[0]?.accessionNumber);
    expect(accessions).toContain("0000000000-26-000002");
    expect(out.matched).toBe(2);
    expect(out.skipped).toBe(0);
  });

  it("does not process gated 8-Ks or Form 15s while the issuer has no spac row", async () => {
    // `sync spacs` worklist IS high/medium candidates, so the handler's
    // `isSpacCandidate` warning fires on every milestone 8-K / Form 15 of a
    // false-positive operating company (VolitionRx, CIK 93314) that will never
    // mint a row. Date-order replay plus the repair pass already handle a real
    // SPAC: skip the gated extractors until the row exists, then pick them up.
    await seedSpacCandidate();
    await seedFiling("0000000000-26-000001", "8-K", "2011-03-01", "d8k.htm", "1.01");
    await seedFiling("0000000000-26-000002", "15-12B", "2011-04-01", null);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const spy = vi
      .spyOn(ProcessAccessionDocFormTask.prototype, "execute")
      .mockResolvedValue({ success: true });
    try {
      const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

      expect(spy).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      expect(out.matched).toBe(2);
      expect(out.skipped).toBe(2);
      expect(out.processed).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("repair-passes a never-processed 8-K dated before the S-1 that mints the row", async () => {
    // First-time replay (no success row) used to process the 8-K in the first
    // pass because shouldReplay said "unprocessed". Date order then ran it
    // before the S-1, dropped the milestone, and warned. The repair pass is
    // how gated filings wait for the row — including ones never processed.
    await seedFiling("0000000000-26-000001", "8-K", "2020-12-01", "d8k.htm", "5.07");
    await seedFiling("0000000000-26-000002", "S-1", "2021-01-04", "s1.htm");
    const spy = mockFormProcessor();

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    const accessions = spy.mock.calls.map((c) => c[0]?.accessionNumber);
    expect(accessions).toEqual(["0000000000-26-000002", "0000000000-26-000001"]);
    expect(out.matched).toBe(2);
    expect(out.skipped).toBe(0);
  });

  it("reaches a fixpoint: a second invocation processes nothing", async () => {
    // The invariant every gated predicate must hold: processing a filing writes
    // the artifact the predicate keys on, so it leaves the selected set. This
    // one property covers the 20-F, the 5.03-only 8-K, the optional-form proxy
    // and the same-run repair pass at once — any of them re-selecting means the
    // second invocation replays work that the first already did.
    await seedGatedTimeline();
    const spy = mockFormProcessor();

    await new ProcessSpacTimelineTask().run({ cik: CIK });
    spy.mockClear();
    const second = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).not.toHaveBeenCalled();
    expect(second.matched).toBe(2);
    expect(second.skipped).toBe(second.matched);
  });

  it("does not run a second pass under --dry-run", async () => {
    // `--dry-run` no-ops every write, so a repair pass would make live model
    // calls and then read its outcome counts back from rows that never landed.
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    await seedGatedTimeline();

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).not.toHaveBeenCalled();
    expect(out.matched).toBe(2);
    expect(out.skipped).toBe(1);
  });

  it("dry-run with a successful filing reports skipped and does not call the processor", async () => {
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");
    await seedSuccessfulRun("0000000000-26-000001", "D", "D");

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).not.toHaveBeenCalled();
    expect(out.matched).toBe(2);
    expect(out.skipped).toBe(1);
    expect(out.processed).toBe(0);
    expect(out.failed).toBe(0);
  });

  it("force all dry-run does not wipe derived events", async () => {
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedIpoEvent("ipo");

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK, force: "all" });

    expect(spy).not.toHaveBeenCalled();
    expect((await new SpacRepo().getEvents(CIK)).map((e) => e.event_type)).toEqual(["ipo"]);
    expect(out.skipped).toBe(0);
    expect(out.matched).toBe(1);
  });

  it("force all live wipes events before replaying every filing", async () => {
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");
    await seedSuccessfulRun("0000000000-26-000001", "D", "D");
    // Off this timeline entirely: extractor_runs is an audit trail the
    // coverage gate counts and nothing can rebuild, so a per-issuer reset must
    // not reach an extractor the replay is not about to rewrite.
    await seedSuccessfulRun("0000000000-26-000003", "424B4", "424");
    await seedIpoEvent("ipo");

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK, force: "all" });

    const runs = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    expect((await runs.findRun(CIK, "0000000000-26-000003", "424", "1.0.0"))?.success).toBe(true);
    expect(await new SpacRepo().getEvents(CIK)).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(out.skipped).toBe(0);
    expect(out.matched).toBe(2);
  });

  it("force redemption does not delete a sibling ipo event", async () => {
    await seedFiling("0000000000-26-000001", "S-1", "2021-01-04");
    await seedFiling("0000000000-26-000002", "8-K", "2021-02-04", null, "5.07,9.01");
    await seedSuccessfulRun("0000000000-26-000001", "S-1", "S-1-xbrl");
    await seedSuccessfulEightKRun("0000000000-26-000002");
    await seedIpoEvent("ipo");

    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");
    const out = await new ProcessSpacTimelineTask().run({ cik: CIK, force: "redemption" });

    expect((await new SpacRepo().getEvents(CIK)).map((e) => e.event_type)).toEqual(["ipo"]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]?.accessionNumber).toBe("0000000000-26-000002");
    expect(out.skipped).toBe(1);
    expect(out.matched).toBe(2);
  });

  it("owns each filing as a child of the issuer so the CLI can nest them", async () => {
    // An owned inner Workflow+Map sits two layers down; the CLI stops
    // recursing there, so the issuer map row had no filing children. Directly
    // owned form tasks are the issuer's subgraph.
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedFiling("0000000000-26-000002", "D", "2021-02-04");
    vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute").mockResolvedValue({
      success: true,
    });

    const task = new ProcessSpacTimelineTask();
    await task.run({ cik: CIK });

    const children = task.subGraph?.getTasks() ?? [];
    expect(children.map((child) => child.type)).toEqual([
      "ProcessAccessionDocFormTask",
      "ProcessAccessionDocFormTask",
    ]);
    expect(children.map((child) => child.title)).toEqual([
      "D 0000000000-26-000001",
      "D 0000000000-26-000002",
    ]);
  });

  it("bounds the retained filing rows so a long timeline cannot grow the graph without limit", async () => {
    // `own` is add-only, so an issuer with thousands of filings held one live
    // task node per filing for the whole run. The nesting above is kept for
    // the timelines a person watches; past the cap the finished row is
    // released and the in-flight filing is still owned while it runs.
    const total = MAX_RETAINED_FILING_ROWS + 5;
    for (let i = 0; i < total; i++) {
      await seedFiling(`0000000000-26-${String(i).padStart(6, "0")}`, "D", "2021-01-04");
    }
    vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute").mockResolvedValue({
      success: true,
    });

    const task = new ProcessSpacTimelineTask();
    const out = await task.run({ cik: CIK });

    expect(out.matched).toBe(total);
    expect(task.subGraph?.getTasks().length ?? 0).toBe(MAX_RETAINED_FILING_ROWS);
  });

  it("labels the issuer row with the CIK so map iterations are distinguishable", async () => {
    const task = new ProcessSpacTimelineTask();
    await task.run({ cik: CIK });
    expect(task.title).toContain(String(CIK));
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

  it("filedOnOrAfter skips older unprocessed filings, keeping date order for the rest", async () => {
    await seedFiling("0000000000-26-000001", "D", "2021-01-04");
    await seedFiling("0000000000-26-000002", "D", "2026-08-20");
    const spy = vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute");

    const out = await new ProcessSpacTimelineTask().run({
      cik: CIK,
      filedOnOrAfter: "2026-08-19",
    });

    expect(spy.mock.calls.map((c) => c[0]?.accessionNumber)).toEqual(["0000000000-26-000002"]);
    expect(out.matched).toBe(2);
    expect(out.skipped).toBe(1);
  });

  it("filedOnOrAfter also keeps the repair pass from replaying older gated 8-Ks", async () => {
    await seedFiling("0000000000-26-000001", "S-1", "2026-08-20", "s1.htm");
    await seedFiling("0000000000-26-000002", "8-K", "2021-02-04", "d8k.htm", "5.07");
    await seedSuccessfulEightKRun("0000000000-26-000002");
    const spy = mockFormProcessor();

    await new ProcessSpacTimelineTask().run({ cik: CIK, filedOnOrAfter: "2026-08-19" });

    expect(spy.mock.calls.map((c) => c[0]?.accessionNumber)).toEqual(["0000000000-26-000001"]);
  });

  it("puts a filing on the timeline when only the registry knows its form", async () => {
    // `S-4` has no entry in the 1:1 map, so a map lookup drops the filing from
    // the timeline entirely — no count, no replay, and nothing saying so.
    await seedFiling("0000000000-26-000001", S4, "2021-02-04", "s4.htm");
    vi.spyOn(ProcessAccessionDocFormTask.prototype, "execute").mockResolvedValue({ success: true });

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(out.matched).toBe(1);
  });

  it("holds back a filing whose SECOND extractor is row-gated until the spac row exists", async () => {
    // The gate asks whether ANY of the form's extractors is known-SPAC-gated.
    // Answered for the first alone this `S-4` reads as ungated, and its
    // merger-proxy half runs before the registration statement mints the row —
    // recording a success while writing nothing, which is unrecoverable.
    await seedFiling("0000000000-26-000001", S4, "2021-02-04", "s4.htm");
    const spy = vi
      .spyOn(ProcessAccessionDocFormTask.prototype, "execute")
      .mockResolvedValue({ success: true });

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).not.toHaveBeenCalled();
    expect(out.skipped).toBe(1);
  });

  it("skips a two-extractor filing only once every one of them has succeeded", async () => {
    await seedExtractorVersion("S-4");
    await new SpacReportWriter().recordRegistration({
      cik: CIK,
      accession_number: "0000000000-26-000001",
      filing_date: "2021-01-04",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Two Extractor SPAC",
      spac_sic: 6770,
    });
    await seedFiling("0000000000-26-000002", S4, "2021-02-04", "s4.htm");
    await seedSuccessfulRun("0000000000-26-000002", S4, "S-4");
    await seedSuccessfulRun("0000000000-26-000002", S4, "merger-proxy");
    await seedMergerExtraction("0000000000-26-000002");
    const spy = vi
      .spyOn(ProcessAccessionDocFormTask.prototype, "execute")
      .mockResolvedValue({ success: true });

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy).not.toHaveBeenCalled();
    expect(out.matched).toBe(1);
    expect(out.skipped).toBe(1);
  });

  it("replays a two-extractor filing when only its first extractor has succeeded", async () => {
    // The mirror of the case above, and the one a single-id lookup gets wrong:
    // the second extractor still owes its run, so the filing is not done.
    await seedExtractorVersion("S-4");
    await new SpacReportWriter().recordRegistration({
      cik: CIK,
      accession_number: "0000000000-26-000001",
      filing_date: "2021-01-04",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Two Extractor SPAC",
      spac_sic: 6770,
    });
    await seedFiling("0000000000-26-000002", S4, "2021-02-04", "s4.htm");
    await seedSuccessfulRun("0000000000-26-000002", S4, "S-4");
    await seedMergerExtraction("0000000000-26-000002");
    const spy = vi
      .spyOn(ProcessAccessionDocFormTask.prototype, "execute")
      .mockResolvedValue({ success: true });

    const out = await new ProcessSpacTimelineTask().run({ cik: CIK });

    expect(spy.mock.calls.map((c) => c[0]?.accessionNumber)).toEqual(["0000000000-26-000002"]);
    expect(out.skipped).toBe(0);
  });
});
