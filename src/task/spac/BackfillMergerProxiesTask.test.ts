/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, TaskAbortedError, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { SpacMergerExtractionRepo } from "../../storage/spac/SpacMergerExtractionRepo";
import {
  BackfillMergerProxiesTask,
  selectMergerProxyBackfillAccessions,
} from "./BackfillMergerProxiesTask";

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
    items: "",
    act: null,
  } as never);
}

async function seedExtraction(accession_number: string, cik: number, form: string): Promise<void> {
  await new SpacMergerExtractionRepo().save({
    accession_number,
    cik,
    form,
    filing_date: "2026-03-20",
    extractor_id: "merger-proxy",
    extractor_version: "1.0.0",
    target_name: "Acme Target Inc.",
    target_cik: null,
    target_observation_id: null,
    pipe_amount: null,
    merger_consideration: null,
    confidence: 0.9,
    source_span: null,
    model_id: null,
    created_at: new Date().toISOString(),
  });
}

describe("selectMergerProxyBackfillAccessions", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("selects known-SPAC merger proxies lacking an extraction row only", async () => {
    await seedSpac(5);
    // Known SPAC, no extraction yet -> selected (these are the gated filings).
    await seedFiling({ cik: 5, accession_number: "acc-defm", form: "DEFM14A" });
    await seedFiling({ cik: 5, accession_number: "acc-prem", form: "PREM14A" });
    // Known SPAC merger proxy that was already extracted -> skipped.
    await seedFiling({ cik: 5, accession_number: "acc-done", form: "DEFM14C" });
    await seedExtraction("acc-done", 5, "DEFM14C");
    // Known SPAC, but not a merger-proxy form -> not selected.
    await seedFiling({ cik: 5, accession_number: "acc-10k", form: "10-K" });
    // Merger proxy for a CIK with no spac row -> not selected.
    await seedFiling({ cik: 6, accession_number: "acc-nonspac", form: "DEFM14A" });

    const accessions = await selectMergerProxyBackfillAccessions();
    expect(accessions.sort()).toEqual(["acc-defm", "acc-prem"]);
  });
});

describe("BackfillMergerProxiesTask abort handling", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("rethrows TaskAbortedError and processes nothing when the signal is aborted", async () => {
    await seedSpac(7);
    await seedFiling({ cik: 7, accession_number: "acc-defm-7", form: "DEFM14A" });
    // Sanity: there is a selectable filing, so the loop body is reached.
    expect((await selectMergerProxyBackfillAccessions()).length).toBeGreaterThan(0);

    const controller = new AbortController();
    controller.abort();
    const ctx = { signal: controller.signal } as IExecuteContext;

    // A cooperative cancellation must surface as TaskAbortedError, not be
    // swallowed by the per-accession catch like a fetch/parse failure.
    await expect(new BackfillMergerProxiesTask().execute({}, ctx)).rejects.toBeInstanceOf(
      TaskAbortedError
    );

    // Nothing was reprocessed -> still no extraction row for the filing.
    expect(await new SpacMergerExtractionRepo().getByAccession("acc-defm-7")).toBeUndefined();
  });
});
