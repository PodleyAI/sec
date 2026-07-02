/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { IExecuteContext } from "workglow";
import { getGlobalModelRepository, globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { registerFakeStructuredProvider } from "../../sec/forms/registration-statements/s1/testing/fakeStructuredProvider";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

class CapturingTask extends ProcessAccessionDocFormTask {
  public readonly fetched: string[] = [];

  protected override async runFetch(
    _cik: number,
    _accessionNumber: string,
    fileName: string,
    _context: IExecuteContext
  ): Promise<string> {
    this.fetched.push(fileName);
    return "<SEC-HEADER></SEC-HEADER>";
  }
}

async function seedSpac(cik: number): Promise<void> {
  await new SpacReportWriter().recordRegistration({
    cik,
    accession_number: `${cik}-reg`,
    filing_date: "2025-12-01",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "Redeem SPAC Inc.",
    spac_sic: 6770,
  });
}

async function seedFiling(opts: {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly primary_doc: string;
  readonly items: string;
}): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: opts.cik,
    accession_number: opts.accession_number,
    form: opts.form,
    primary_doc: opts.primary_doc,
    file_number: "",
    filing_date: "2026-03-20",
    acceptance_date: "2026-03-20T00:00:00.000Z",
    report_date: "2026-03-19",
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: opts.items,
    act: null,
  } as never);
}

describe("ProcessAccessionDocFormTask redemption fetch escalation", () => {
  let escCleanup: (() => void) | undefined;
  let escPrevRedemptionModel: string | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    // processRedemption8K now reaches `getRedemptionModel()` on the
    // known-SPAC + trigger-item path; register a fake model so the call
    // doesn't throw before the assertion this suite cares about (fetch
    // escalation). The fake provider is wired in only for the trigger-item
    // test that actually reaches the AI extractor.
    escPrevRedemptionModel = process.env.SEC_REDEMPTION_MODEL;
    process.env.SEC_REDEMPTION_MODEL = "fake-s1-model";
    await getGlobalModelRepository().addModel({
      model_id: "fake-s1-model",
      capabilities: ["text.generation", "json-mode"],
      title: "Fake",
      description: "Fake",
      provider: "fake-structured",
      provider_config: {},
      metadata: {},
    } as any);
  });

  afterEach(async () => {
    escCleanup?.();
    escCleanup = undefined;
    await getGlobalModelRepository().removeModel("fake-s1-model");
    if (escPrevRedemptionModel === undefined) delete process.env.SEC_REDEMPTION_MODEL;
    else process.env.SEC_REDEMPTION_MODEL = escPrevRedemptionModel;
  });

  it("fetches the full .txt for a known-SPAC trigger-item 8-K", async () => {
    const accession = "0000000000-26-000007";
    await seedSpac(7);
    await seedFiling({
      cik: 7,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07,9.01",
    });
    // The fake provider must be registered before the run so the redemption
    // AI extractor can complete (its output is irrelevant here; we assert
    // only fetch escalation).
    const reg = registerFakeStructuredProvider([
      {
        redemption_shares: 0,
        redemption_amount: 0,
        price_per_share: 0,
        confidence: 0,
        source_span: "",
      },
    ]);
    escCleanup = reg.unregister;
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain(`${accession}.txt`);
  });

  it("keeps the primary-doc fetch for a non-trigger item", async () => {
    const accession = "0000000000-26-000008";
    await seedSpac(7);
    await seedFiling({
      cik: 7,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "2.02",
    });
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain("primary.htm");
    expect(task.fetched).not.toContain(`${accession}.txt`);
  });

  it("keeps the primary-doc fetch for a non-SPAC CIK", async () => {
    const accession = "0000000000-26-000010";
    await seedFiling({
      cik: 99,
      accession_number: accession,
      form: "8-K",
      primary_doc: "primary.htm",
      items: "5.07",
    });
    const task = new CapturingTask();
    await task.run({ accessionNumber: accession });
    expect(task.fetched).toContain("primary.htm");
    expect(task.fetched).not.toContain(`${accession}.txt`);
  });
});

describe("ProcessAccessionDocFormTask redemption extractor_runs recording", () => {
  let cleanup: (() => void) | undefined;
  let prevRedemptionModel: string | undefined;

  const FULL_TXT =
    "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-000050\n</SEC-HEADER>\n" +
    "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n<p>Vote results.</p>\n</TEXT>\n</DOCUMENT>\n" +
    "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
    "<p>Holders of 1,234,567 shares elected to redeem for $12,400,000.</p>\n" +
    "</TEXT>\n</DOCUMENT>\n";

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    prevRedemptionModel = process.env.SEC_REDEMPTION_MODEL;
    process.env.SEC_REDEMPTION_MODEL = "fake-s1-model";

    await getGlobalModelRepository().addModel({
      model_id: "fake-s1-model",
      capabilities: ["text.generation", "json-mode"],
      title: "Fake",
      description: "Fake",
      provider: "fake-structured",
      provider_config: {},
      metadata: {},
    } as any);
  });

  afterEach(async () => {
    cleanup?.();
    cleanup = undefined;
    await getGlobalModelRepository().removeModel("fake-s1-model");
    if (prevRedemptionModel === undefined) delete process.env.SEC_REDEMPTION_MODEL;
    else process.env.SEC_REDEMPTION_MODEL = prevRedemptionModel;
    resetDependencyInjectionsForTesting();
  });

  class FixedBodyTask extends ProcessAccessionDocFormTask {
    constructor(private readonly bodyText: string) {
      super();
    }
    protected override async runFetch(
      _cik: number,
      _accessionNumber: string,
      _fileName: string,
      _context: IExecuteContext
    ): Promise<string> {
      return this.bodyText;
    }
  }

  it("records a successful redemption extractor_runs row after a clean run", async () => {
    const cik = 50;
    const accession = "0000000000-26-000050";

    await new SpacReportWriter().recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Redeem SPAC Inc.",
      spac_sic: 6770,
    });
    await new SpacReportWriter().recordDealMilestones({
      cik,
      accession_number: `${cik}-da`,
      filing_date: "2026-01-10",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2026-01-10" }],
    });
    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await repo.put({
      cik,
      accession_number: accession,
      form: "8-K",
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
      items: "5.07",
      act: null,
    } as never);

    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 1234567,
        redemption_amount: 12400000,
        price_per_share: 10.05,
        confidence: 0.95,
        source_span: "1,234,567 shares elected to redeem for $12,400,000",
      },
    ]);
    cleanup = registration.unregister;

    await new FixedBodyTask(FULL_TXT).run({ accessionNumber: accession });

    const runRepo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    const run = await runRepo.findRun(cik, accession, "redemption", "1.0.0");
    expect(run?.success).toBe(true);
    expect(run?.error).toBeNull();
  });
});
