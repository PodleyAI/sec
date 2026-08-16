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
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import {
  formsForExtractor,
  getBackfillDescriptor,
  listBackfillableExtractorIds,
} from "./backfillDescriptors";

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
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    primary_doc: "primary.htm",
    file_number: "",
    filing_date: "2026-03-20",
    acceptance_date: "2026-03-20T00:00:00.000Z",
    report_date: "2026-03-19",
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: opts.items ?? null,
    act: null,
  } as never);
}

describe("backfill descriptor registry", () => {
  it("resolves a custom descriptor for the sub-extractors and merger-proxy", () => {
    for (const id of ["redemption", "loi", "merger-proxy", "25-15", "RW"]) {
      expect(getBackfillDescriptor(id)?.extractorId).toBe(id);
    }
    // merger-proxy, 25-15, and RW override the needing-work predicate; the 8-K sub-extractors don't.
    expect(getBackfillDescriptor("merger-proxy")?.filterTodo).toBeDefined();
    expect(getBackfillDescriptor("25-15")?.filterTodo).toBeDefined();
    expect(getBackfillDescriptor("RW")?.filterTodo).toBeDefined();
    expect(getBackfillDescriptor("redemption")?.filterTodo).toBeUndefined();
  });

  it("resolves a generic form-based descriptor for every form-routed extractor", () => {
    for (const id of ["S-1", "424", "8-K", "C", "D", "CFPORTAL", "1-A", "144"]) {
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
    expect(formsForExtractor("S-1").sort()).toEqual(
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
      merger_consideration: null,
      confidence: 0.9,
      source_span: null,
      model_id: null,
      created_at: "2026-03-20T00:00:00.000Z",
    });
    const todo = await descriptor.filterTodo!(candidates);
    expect(todo.map((c) => c.accession_number)).toEqual(["acc-prem"]);
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

    const candidates = await getBackfillDescriptor("S-1")!.selectCandidates();
    const accessions = new Set(candidates.map((c) => c.accession_number));
    expect(accessions).toEqual(new Set(["acc-s1", "acc-s1a", "acc-drs"]));
  });
});
