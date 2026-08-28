/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { processDeregistration } from "../../sec/forms/exchange-listing-withdrawal/processDeregistration";
import { processWithdrawal } from "../../sec/forms/registration-withdrawal-termination/processWithdrawal";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { SpacRedemptionExtractionRepo } from "../../storage/spac/SpacRedemptionExtractionRepo";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { registerFormExtractor } from "../../sec/forms/formExtractors";
import { PARSER_ONLY_FORMS_BY_EXTRACTOR } from "../../sec/forms/parserOnlyForms";
import { SpacLoiExtractionRepo } from "../../storage/spac/SpacLoiExtractionRepo";
import { hasLoiTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import {
  formsForExtractor,
  getBackfillDescriptor,
  listBackfillableExtractorIds,
  registerBackfillDescriptor,
  spacTrigger8KDescriptor,
} from "./backfillDescriptors";

// This package parses the proxy family and does not read it — the
// `merger-proxy` extractor is supplied by a consumer — so no proxy form routes
// anywhere here and the descriptor below would select nothing. The descriptor
// stays because this package still holds the tables that extractor's runs
// wrote, and its selection and needing-work predicate still have to be right
// wherever the consumer IS present. A stand-in over exactly the forms this
// package pins as parser-only is what keeps them under test rather than
// vacuously empty.
registerFormExtractor({
  id: "merger-proxy",
  forms: PARSER_ONLY_FORMS_BY_EXTRACTOR["merger-proxy"],
  store: async () => {},
});

// The redemption and LOI passes run inside another extractor's `store` and are
// supplied by the package that ships the 8-K narrative reading, so nothing
// registers their descriptors here. Registering them locally is what keeps
// their selection and needing-work predicates — which read tables this package
// owns — under test rather than unreachable.
registerBackfillDescriptor(
  spacTrigger8KDescriptor(
    "redemption",
    "redemption",
    hasRedemptionTriggerItem,
    async (accession_number) =>
      (await new SpacRedemptionExtractionRepo().getByAccession(accession_number)) !== undefined
  )
);
registerBackfillDescriptor(
  spacTrigger8KDescriptor(
    "loi",
    "loi",
    hasLoiTriggerItem,
    async (accession_number) =>
      (await new SpacLoiExtractionRepo().getByAccession(accession_number)) !== undefined
  )
);

async function seedSpac(cik: number): Promise<void> {
  await new SpacReportWriter().recordRegistration({
    cik,
    accession_number: `${cik}-reg`,
    filing_date: "2025-12-01",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "Backfill SPAC Inc.",
    spac_sic: 6770,
  });
}

async function seedFiling(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly items?: string;
  readonly filing_date?: string;
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const filing_date = opts.filing_date ?? "2026-03-20";
  await repo.put({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    primary_doc: "primary.htm",
    file_number: "",
    filing_date,
    acceptance_date: `${filing_date}T00:00:00.000Z`,
    report_date: filing_date,
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: opts.items ?? null,
    act: null,
  } as never);
}

/** A `success: true` run at the bootstrapped active version (1.0.0). */
async function recordSuccessfulRun(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly extractorId: string;
}): Promise<void> {
  await new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)).recordRun({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: "8-K",
    extractor_id: opts.extractorId,
    extractor_version: "1.0.0",
    slot_at_run: "current",
    success: true,
    error: null,
  });
}

/**
 * The residue of the auto-resolve bug: a catch-all failure that was marked
 * resolved. `markResolved` keeps the reason code, which is what makes the row
 * recoverable at all.
 */
async function recordResolvedInvalidOutput(opts: {
  readonly extractorId: string;
  readonly accession_number: string;
  readonly section_name: string;
}): Promise<void> {
  const dl = new ExtractionDeadLetterRepo();
  await dl.record({
    extractor_id: opts.extractorId,
    accession_number: opts.accession_number,
    section_name: opts.section_name,
    reason_code: "MODEL_INVALID_OUTPUT",
    detail: "response did not match schema",
    failed_extractor_version: "1.0.0",
    source_run_id: null,
  });
  await dl.markResolved(opts.extractorId, opts.accession_number, opts.section_name);
}

describe("backfill descriptor registry", () => {
  it("resolves a custom descriptor for the sub-extractors and merger-proxy", () => {
    for (const id of ["redemption", "loi", "merger-proxy", "25-15", "RW"]) {
      expect(getBackfillDescriptor(id)?.extractorId).toBe(id);
    }
    // Every custom descriptor overrides the needing-work predicate; the 8-K
    // sub-extractors widen the default rather than replace it.
    expect(getBackfillDescriptor("merger-proxy")?.filterTodo).toBeDefined();
    expect(getBackfillDescriptor("25-15")?.filterTodo).toBeDefined();
    expect(getBackfillDescriptor("RW")?.filterTodo).toBeDefined();
    expect(getBackfillDescriptor("redemption")?.filterTodo).toBeDefined();
    expect(getBackfillDescriptor("loi")?.filterTodo).toBeDefined();
  });

  it("resolves a generic form-based descriptor for every form-routed extractor", () => {
    for (const id of ["S-1-xbrl", "424-xbrl", "8-K", "C", "D", "CFPORTAL", "1-A", "144"]) {
      expect(getBackfillDescriptor(id)?.extractorId).toBe(id);
    }
  });

  it("returns undefined for unknown extractor ids", () => {
    expect(getBackfillDescriptor("nope")).toBeUndefined();
  });

  it("lists every backfillable id, including the sub-extractors", () => {
    const ids = listBackfillableExtractorIds();
    for (const id of ["S-1", "8-K", "merger-proxy", "redemption", "loi", "25-15", "RW"]) {
      expect(ids).toContain(id);
    }
  });

  it("formsForExtractor maps an extractor id back to its routed forms", () => {
    expect(formsForExtractor("S-1-xbrl").sort()).toEqual(
      ["DRS", "DRS/A", "F-1", "F-1/A", "F-1MEF", "S-1", "S-1/A", "S-1MEF"].sort()
    );
    expect(formsForExtractor("loi")).toEqual([]);
  });
});

describe("known-SPAC trigger-8K selectors (redemption / loi)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  async function seedFixture(): Promise<void> {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-vote", form: "8-K", items: "5.07" });
    await seedFiling({ cik: 5, accession_number: "acc-amend", form: "8-K/A", items: "2.01" });
    await seedFiling({ cik: 5, accession_number: "acc-other", form: "8-K", items: "7.01" });
    await seedFiling({ cik: 5, accession_number: "acc-earnings", form: "8-K", items: "2.02" });
    await seedFiling({ cik: 5, accession_number: "acc-10k", form: "10-K", items: "5.07" });
    // Non-SPAC cik: trigger-item 8-K, but no spac row.
    await seedFiling({ cik: 6, accession_number: "acc-nonspac", form: "8-K", items: "5.07" });
  }

  it("redemption selects known-SPAC redemption-trigger 8-Ks (incl. 8-K/A) only", async () => {
    await seedFixture();
    const candidates = await getBackfillDescriptor("redemption")!.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions).toEqual(new Set(["acc-vote", "acc-amend"]));
    for (const c of candidates) expect(c.cik).toBe(5);
  });

  it("loi selects known-SPAC LOI-trigger 8-Ks only", async () => {
    await seedFixture();
    const candidates = await getBackfillDescriptor("loi")!.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    // 7.01 is an LOI trigger; 5.07 and 2.02 are not; 2.01 is not either.
    expect(accessions).toEqual(new Set(["acc-other"]));
  });

  it("re-selects a redemption 8-K whose catch-all dead letter was resolved with no extraction row", async () => {
    // The corrupted shape the auto-resolve bug left behind: the detector threw,
    // the section runner recorded MODEL_INVALID_OUTPUT, the detector recorded a
    // SUCCESSFUL run anyway, and the entry was then marked resolved. Nothing
    // was extracted. The successful run row is what makes the default anti-join
    // untrustworthy here — it says the filing was processed when the only thing
    // that happened was a failure that has since been cleared off the worklist.
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-vote", form: "8-K", items: "5.07" });
    await recordSuccessfulRun({ cik: 5, accession_number: "acc-vote", extractorId: "redemption" });
    await recordResolvedInvalidOutput({
      extractorId: "redemption",
      accession_number: "acc-vote",
      section_name: "redemption",
    });

    const descriptor = getBackfillDescriptor("redemption")!;
    const todo = await descriptor.filterTodo!(await descriptor.selectCandidates());
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-vote"]);
  });

  it("does not re-select a confident negative", async () => {
    // MODEL_EMPTY is the expected answer for most trigger 8-Ks. Selecting it
    // would turn this descriptor into a re-run-everything-forever sweep that
    // re-pays an AI call per 8-K on every pass.
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-vote", form: "8-K", items: "5.07" });
    await recordSuccessfulRun({ cik: 5, accession_number: "acc-vote", extractorId: "redemption" });
    const dl = new ExtractionDeadLetterRepo();
    await dl.record({
      extractor_id: "redemption",
      accession_number: "acc-vote",
      section_name: "redemption",
      reason_code: "MODEL_EMPTY",
      detail: null,
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });
    await dl.markResolved("redemption", "acc-vote", "redemption");

    const descriptor = getBackfillDescriptor("redemption")!;
    expect(await descriptor.filterTodo!(await descriptor.selectCandidates())).toEqual([]);
  });

  it("does not re-select a catch-all entry whose filing did produce an extraction row", async () => {
    // A later clean run wrote the extraction but left the reason code in place
    // (markResolved does not rewrite it), so the code alone would over-select.
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-vote", form: "8-K", items: "5.07" });
    await recordSuccessfulRun({ cik: 5, accession_number: "acc-vote", extractorId: "redemption" });
    await recordResolvedInvalidOutput({
      extractorId: "redemption",
      accession_number: "acc-vote",
      section_name: "redemption",
    });
    await new SpacRedemptionExtractionRepo().save({
      accession_number: "acc-vote",
      cik: 5,
      form: "8-K",
      filing_date: "2026-03-20",
      extractor_id: "redemption",
      extractor_version: "1.0.0",
      redemption_shares: 1_000,
      redemption_amount: 10_000,
      price_per_share: 10,
      confidence: 0.9,
      source_span: null,
      model_id: null,
      created_at: "2026-03-20T00:00:00.000Z",
    });

    const descriptor = getBackfillDescriptor("redemption")!;
    expect(await descriptor.filterTodo!(await descriptor.selectCandidates())).toEqual([]);
  });

  it("still selects a filing that never ran", async () => {
    // Pins that the union widened the default anti-join rather than replacing
    // it: the ordinary "no successful run" candidate must still come through.
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-vote", form: "8-K", items: "5.07" });

    const descriptor = getBackfillDescriptor("redemption")!;
    const todo = await descriptor.filterTodo!(await descriptor.selectCandidates());
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-vote"]);
  });

  it("re-selects an LOI 8-K whose catch-all dead letter was resolved with no extraction row", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-other", form: "8-K", items: "7.01" });
    await recordSuccessfulRun({ cik: 5, accession_number: "acc-other", extractorId: "loi" });
    await recordResolvedInvalidOutput({
      extractorId: "loi",
      accession_number: "acc-other",
      section_name: "loi",
    });

    const descriptor = getBackfillDescriptor("loi")!;
    const todo = await descriptor.filterTodo!(await descriptor.selectCandidates());
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-other"]);
  });

  it("aggregates candidates across multiple SPACs in bulk form queries", async () => {
    await seedSpac(5);
    await seedSpac(7);
    await seedFiling({ cik: 5, accession_number: "acc-5a", form: "8-K", items: "5.07" });
    await seedFiling({ cik: 5, accession_number: "acc-5b", form: "8-K", items: "2.02" });
    await seedFiling({ cik: 7, accession_number: "acc-7a", form: "8-K/A", items: "2.01" });
    await seedFiling({ cik: 7, accession_number: "acc-7b", form: "8-K", items: "9.01" });

    const candidates = await getBackfillDescriptor("redemption")!.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions).toEqual(new Set(["acc-5a", "acc-7a"]));
  });
});

describe("merger-proxy descriptor", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  async function saveMergerExtraction(
    accession_number: string,
    cik: number,
    form: string,
    seeks_combination_approval: boolean | null
  ): Promise<void> {
    await new SpacMergerExtractionRepo().save({
      accession_number,
      cik,
      form,
      filing_date: "2026-03-20",
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      target_name: "Target Co",
      target_cik: null,
      target_observation_id: null,
      target_description: null,
      pipe_amount: null,
      equity_value: null,
      enterprise_value: null,
      merger_consideration: null,
      confidence: 0.9,
      source_span: null,
      seeks_combination_approval,
      model_id: null,
      created_at: "2026-03-20T00:00:00.000Z",
    });
  }

  it("selects known-SPAC merger proxies; filterTodo keeps those lacking an extraction row", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-defm", form: "DEFM14A" });
    await seedFiling({ cik: 5, accession_number: "acc-prem", form: "PREM14A" });
    await seedFiling({ cik: 5, accession_number: "acc-8k", form: "8-K", items: "1.01" });
    // Non-SPAC proxy: excluded.
    await seedFiling({ cik: 6, accession_number: "acc-nonspac", form: "DEFM14A" });

    const descriptor = getBackfillDescriptor("merger-proxy")!;
    const candidates = await descriptor.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions).toEqual(new Set(["acc-defm", "acc-prem"]));

    // One already extracted: filterTodo drops it even though a run exists for neither.
    await new SpacMergerExtractionRepo().save({
      accession_number: "acc-defm",
      cik: 5,
      form: "DEFM14A",
      filing_date: "2026-03-20",
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      target_name: "Target Co",
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
      created_at: "2026-03-20T00:00:00.000Z",
    });
    const todo = await descriptor.filterTodo!(candidates);
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-prem"]);
  });

  it("re-selects a general definitive proxy whose gate verdict was never recorded", async () => {
    // Rows written before the approval gate carry a null verdict, so a stale
    // proxy event may be standing on them; re-running re-derives the verdict
    // from the document with no model call.
    await seedSpac(7);
    await seedFiling({ cik: 7, accession_number: "acc-def14a", form: "DEF 14A" });
    await saveMergerExtraction("acc-def14a", 7, "DEF 14A", null);

    const descriptor = getBackfillDescriptor("merger-proxy")!;
    const candidates = await descriptor.selectCandidates();
    const todo = await descriptor.filterTodo!(candidates);
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-def14a"]);
  });

  it("does not re-select it once the verdict is recorded", async () => {
    // The convergence assertion: the widening clause extinguishes itself, so a
    // repeated sweep does not re-process the same proxies forever.
    await seedSpac(8);
    await seedFiling({ cik: 8, accession_number: "acc-def14a", form: "DEF 14A" });
    await saveMergerExtraction("acc-def14a", 8, "DEF 14A", false);

    const descriptor = getBackfillDescriptor("merger-proxy")!;
    const candidates = await descriptor.selectCandidates();
    expect(await descriptor.filterTodo!(candidates)).toEqual([]);
  });

  it("does not re-select an M-form proxy, whose verdict is null by design", async () => {
    // DEFM14A decides on the form symbol, so it never renders the document and
    // never records a verdict; the widening must not chase those forever.
    await seedSpac(9);
    await seedFiling({ cik: 9, accession_number: "acc-defm", form: "DEFM14A" });
    await saveMergerExtraction("acc-defm", 9, "DEFM14A", null);

    const descriptor = getBackfillDescriptor("merger-proxy")!;
    const candidates = await descriptor.selectCandidates();
    expect(await descriptor.filterTodo!(candidates)).toEqual([]);
  });

  it("does not re-select a general proxy whose merger section was legitimately absent", async () => {
    // A `DEF 14A` is usually an annual or extension vote carrying no merger
    // section, and the processor writes no extraction row for one — by design.
    // Selecting on the extraction row alone re-queues every general proxy of
    // every known SPAC on every backfill, forever, each one re-paying the
    // segmentation and AI cost to conclude again that there is nothing there.
    // The resolved SECTION_NOT_FOUND trace is what makes the predicate
    // converge.
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-def14a", form: "DEF 14A" });
    await new ExtractionDeadLetterRepo().recordResolved({
      extractor_id: "merger-proxy",
      accession_number: "acc-def14a",
      section_name: "merger",
      reason_code: "SECTION_NOT_FOUND",
      detail: "no merger / business-combination / PIPE section text",
      failed_extractor_version: "1.0.0",
      source_run_id: null,
    });

    const descriptor = getBackfillDescriptor("merger-proxy")!;
    expect(await descriptor.filterTodo!(await descriptor.selectCandidates())).toEqual([]);
  });
});

describe("25-15 descriptor", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("selects known-SPAC Form 25/15 filings; filterTodo keeps those lacking a deregistration or unit_split event", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-nse", form: "25-NSE" });
    await seedFiling({ cik: 5, accession_number: "acc-15", form: "15-12G" });
    await seedFiling({ cik: 5, accession_number: "acc-8k", form: "8-K", items: "1.01" });
    await seedFiling({ cik: 6, accession_number: "acc-nonspac", form: "15-12G" });

    const descriptor = getBackfillDescriptor("25-15")!;
    const candidates = await descriptor.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions).toEqual(new Set(["acc-nse", "acc-15"]));

    await processDeregistration({
      cik: 5,
      accession_number: "acc-nse",
      form: "25-NSE",
      filing_date: "2026-03-20",
    });
    const todo = await descriptor.filterTodo!(candidates);
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-15"]);
  });

  it("skips a 20-F the classifier ignores", async () => {
    // 20-F routes to this extractor so an FPI CLOSE filing can record its
    // combination; an ORDINARY annual report classifies `ignore` and writes
    // nothing. Selecting it re-runs every annual report of every de-SPAC'd
    // foreign private issuer on every backfill — six 20-Fs is six filings
    // re-processed forever — so the shared predicate refuses it, while the
    // Form 15 beside it is still selected.
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-20f", form: "20-F" });
    await seedFiling({ cik: 5, accession_number: "acc-15", form: "15-12G" });

    const descriptor = getBackfillDescriptor("25-15")!;
    const candidates = await descriptor.selectCandidates();
    expect(candidates.map((c) => c.accession_number).sort()).toEqual(["acc-15", "acc-20f"]);

    const todo = await descriptor.filterTodo!(candidates);
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-15"]);
  });

  it("re-selects a 25-NSE recorded as deregistration that is actually unit separation", async () => {
    await seedSpac(5);
    await new SpacReportWriter().recordIpo({
      cik: 5,
      accession_number: "5-ipo",
      filing_date: "2026-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["FOO.U"],
    });
    await seedFiling({ cik: 5, accession_number: "acc-nse", form: "25-NSE" });

    await new SpacReportWriter().recordDeregistration({
      cik: 5,
      accession_number: "acc-nse",
      form: "25-NSE",
      filing_date: "2026-03-20",
    });
    expect((await new SpacRepo().getSpac(5))?.status).toBe("liquidated");

    const descriptor = getBackfillDescriptor("25-15")!;
    const candidates = await descriptor.selectCandidates();
    const todo = await descriptor.filterTodo!(candidates);
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-nse"]);
  });

  it("re-selects a null-ipo_date 25-NSE recorded as deregistration, then stops once split", async () => {
    // The recovery path for the unknown-floor rule. `seedSpac` records only a
    // registration, so ipo_date is null — the AI-content-classifier shape. A
    // deregistration recorded under the old rule is now the wrong kind, so
    // `sec extractor backfill 25-15` must re-queue it (no --force), and must
    // stop re-queueing once the corrected unit_split exists.
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-nse", form: "25-NSE" });
    await new SpacReportWriter().recordDeregistration({
      cik: 5,
      accession_number: "acc-nse",
      form: "25-NSE",
      filing_date: "2026-03-20",
    });
    expect((await new SpacRepo().getSpac(5))?.ipo_date).toBeNull();

    const descriptor = getBackfillDescriptor("25-15")!;
    expect(
      (await descriptor.filterTodo!(await descriptor.selectCandidates())).map(
        (c) => c.accession_number
      )
    ).toEqual(["acc-nse"]);

    await processDeregistration({
      cik: 5,
      accession_number: "acc-nse",
      form: "25-NSE",
      filing_date: "2026-03-20",
    });

    expect(await descriptor.filterTodo!(await descriptor.selectCandidates())).toEqual([]);
  });

  it("re-selects a 25-15 accession whose recorded completed no longer classifies", async () => {
    // The recovery path for the approval-window fix. The old unbounded rule
    // recorded `completed` for a Form 25 filed 18 months after the vote; the
    // live classifier now says `deregistration`, and filterTodo compares
    // against what is recorded, so the accession is re-queued (no --force).
    await seedSpac(5);
    await new SpacReportWriter().recordIpo({
      cik: 5,
      accession_number: "5-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["FOO.U"],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 5,
      accession_number: "5-vote",
      filing_date: "2023-02-01",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2023-02-01" }],
    });
    await seedFiling({ cik: 5, accession_number: "acc-25", form: "25", filing_date: "2024-08-01" });
    await new SpacReportWriter().recordCompleted({
      cik: 5,
      accession_number: "acc-25",
      form: "25",
      filing_date: "2024-08-01",
    });

    const descriptor = getBackfillDescriptor("25-15")!;
    const todo = await descriptor.filterTodo!(await descriptor.selectCandidates());
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-25"]);
  });

  it("needs a second pass when two accessions both carry a stale completed", async () => {
    // The fixpoint requirement, in executable form. `hasPriorCompleted` reads
    // the EVENT stream, so while the Form 25's stale `completed` is still on an
    // earlier accession the Form 15 keeps classifying `completed` too — it
    // matches what is recorded and is skipped. Only after pass one corrects the
    // Form 25 does pass two see the Form 15 for what it is. Operators must run
    // `sec extractor backfill 25-15` until it reports `processed 0`.
    await seedSpac(5);
    await new SpacReportWriter().recordIpo({
      cik: 5,
      accession_number: "5-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["FOO.U"],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 5,
      accession_number: "5-vote",
      filing_date: "2023-02-01",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2023-02-01" }],
    });
    await seedFiling({ cik: 5, accession_number: "acc-25", form: "25", filing_date: "2024-08-01" });
    await seedFiling({
      cik: 5,
      accession_number: "acc-15",
      form: "15-12B",
      filing_date: "2024-09-03",
    });
    for (const [accession_number, form, filing_date] of [
      ["acc-25", "25", "2024-08-01"],
      ["acc-15", "15-12B", "2024-09-03"],
    ] as const) {
      await new SpacReportWriter().recordCompleted({
        cik: 5,
        accession_number,
        form,
        filing_date,
      });
    }

    const descriptor = getBackfillDescriptor("25-15")!;
    const pass1 = await descriptor.filterTodo!(await descriptor.selectCandidates());
    expect(pass1.map((c) => c.accession_number)).toEqual(["acc-25"]);

    // Simulate pass one processing acc-25: the classifier now says
    // deregistration, and recordDeregistration deletes the sibling completed on
    // that accession before appending.
    await new SpacReportWriter().recordDeregistration({
      cik: 5,
      accession_number: "acc-25",
      form: "25",
      filing_date: "2024-08-01",
    });

    const pass2 = await descriptor.filterTodo!(await descriptor.selectCandidates());
    expect(pass2.map((c) => c.accession_number)).toEqual(["acc-15"]);
  });

  it("re-selects a second 25-NSE recorded as deregistration while an earlier split exists", async () => {
    await seedSpac(5);
    await new SpacReportWriter().recordIpo({
      cik: 5,
      accession_number: "5-ipo",
      filing_date: "2026-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["FOO.U"],
    });
    await seedFiling({ cik: 5, accession_number: "acc-nse-1", form: "25-NSE" });
    await seedFiling({ cik: 5, accession_number: "acc-nse-2", form: "25-NSE" });
    await processDeregistration({
      cik: 5,
      accession_number: "acc-nse-1",
      form: "25-NSE",
      filing_date: "2026-03-01",
    });
    await new SpacReportWriter().recordDeregistration({
      cik: 5,
      accession_number: "acc-nse-2",
      form: "25-NSE",
      filing_date: "2026-03-08",
    });
    expect((await new SpacRepo().getSpac(5))?.status).toBe("liquidated");

    const descriptor = getBackfillDescriptor("25-15")!;
    const candidates = await descriptor.selectCandidates();
    const todo = await descriptor.filterTodo!(candidates);
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-nse-2"]);
  });
});

describe("RW descriptor", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("selects known-SPAC Form RW filings; filterTodo keeps those lacking a withdrawal event", async () => {
    await seedSpac(5);
    await seedFiling({ cik: 5, accession_number: "acc-rw", form: "RW" });
    await seedFiling({ cik: 5, accession_number: "acc-rw2", form: "RW" });
    await seedFiling({ cik: 5, accession_number: "acc-8k", form: "8-K", items: "1.01" });
    await seedFiling({ cik: 6, accession_number: "acc-nonspac", form: "RW" });

    const descriptor = getBackfillDescriptor("RW")!;
    const candidates = await descriptor.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions).toEqual(new Set(["acc-rw", "acc-rw2"]));

    await processWithdrawal({
      cik: 5,
      accession_number: "acc-rw",
      form: "RW",
      filing_date: "2022-01-04",
    });
    const todo = await descriptor.filterTodo!(candidates);
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-rw2"]);
  });
});

describe("generic form-based descriptor", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("selects every filing of the extractor's routed forms", async () => {
    await seedFiling({ cik: 1, accession_number: "acc-s1", form: "S-1" });
    await seedFiling({ cik: 1, accession_number: "acc-s1a", form: "S-1/A" });
    await seedFiling({ cik: 2, accession_number: "acc-drs", form: "DRS" });
    await seedFiling({ cik: 2, accession_number: "acc-8k", form: "8-K", items: "8.01" });

    const candidates = await getBackfillDescriptor("S-1-xbrl")!.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions).toEqual(new Set(["acc-s1", "acc-s1a", "acc-drs"]));
  });
});
