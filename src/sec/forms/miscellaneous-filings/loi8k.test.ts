/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { SpacLoiExtractionRepo } from "../../../storage/spac/SpacLoiExtractionRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../../storage/versioning/ExtractorRunSchema";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { processLoi8K } from "./loi8k";
import { hasLoiTriggerItem } from "./spac8kLoiTriggers";

const LOI_SENTENCE =
  "the Company entered into a non-binding letter of intent with Acme Robotics, Inc.";

const FULL_TXT =
  "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-000100\n</SEC-HEADER>\n" +
  "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n<p>Other events.</p>\n</TEXT>\n</DOCUMENT>\n" +
  "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
  `<p>On February 1, 2026, ${LOI_SENTENCE}</p>\n` +
  "</TEXT>\n</DOCUMENT>\n";

const LOI_PAYLOAD = {
  is_loi: true,
  target_name: "Acme Robotics, Inc.",
  loi_date: "2026-02-01",
  confidence: 0.9,
  source_span: LOI_SENTENCE,
};

describe("processLoi8K", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("hasLoiTriggerItem matches trigger codes only", () => {
    expect(hasLoiTriggerItem("8.01,9.01")).toBe(true);
    expect(hasLoiTriggerItem("7.01")).toBe(true);
    expect(hasLoiTriggerItem("1.01")).toBe(true);
    expect(hasLoiTriggerItem("5.07")).toBe(false);
    expect(hasLoiTriggerItem(null)).toBe(false);
  });

  async function seedSearchingSpac(cik: number): Promise<void> {
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2025-06-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Intent SPAC Inc.",
      spac_sic: 6770,
    });
    await writer.recordIpo({
      cik,
      accession_number: `${cik}-ipo`,
      filing_date: "2025-08-01",
      form: "424B4",
      primary_document: "424b4.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 202_000_000,
      spac_tickers: ["INTU"],
    });
  }

  it("persists the extraction, emits the loi event, and lifts loi_date/status onto the row", async () => {
    await seedSearchingSpac(60);
    const registration = registerFakeStructuredProvider([LOI_PAYLOAD]);
    cleanup = registration.unregister;

    await processLoi8K({
      cik: 60,
      accession_number: "0000000000-26-000100",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      event_date: "2026-02-02",
      model: fakeS1Model(),
    });

    const ext = await new SpacLoiExtractionRepo().getByAccession("0000000000-26-000100");
    expect(ext?.target_name).toBe("Acme Robotics, Inc.");
    expect(ext?.loi_date).toBe("2026-02-01");

    const repo = new SpacRepo();
    const events = await repo.getEvents(60);
    const loiEvent = events.find((e) => e.event_type === "loi");
    // The narrative-stated LOI date wins over the report/filing date.
    expect(loiEvent?.event_date).toBe("2026-02-01");

    const deals = await repo.getDeals(60);
    expect(deals).toHaveLength(1);
    expect(deals[0].loi_date).toBe("2026-02-01");
    expect(deals[0].outcome).toBe("pending");

    const spac = await repo.getSpac(60);
    expect(spac?.status).toBe("loi");
    expect(spac?.loi_date).toBe("2026-02-01");
  });

  it("falls back to the report-date event_date when the narrative states no date", async () => {
    await seedSearchingSpac(61);
    const registration = registerFakeStructuredProvider([{ ...LOI_PAYLOAD, loi_date: null }]);
    cleanup = registration.unregister;

    await processLoi8K({
      cik: 61,
      accession_number: "0000000000-26-000101",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      event_date: "2026-02-02",
      model: fakeS1Model(),
    });

    const events = await new SpacRepo().getEvents(61);
    expect(events.find((e) => e.event_type === "loi")?.event_date).toBe("2026-02-02");
    expect((await new SpacRepo().getSpac(61))?.loi_date).toBe("2026-02-02");
  });

  it("a later definitive agreement supersedes the LOI stage on the same deal", async () => {
    await seedSearchingSpac(62);
    const registration = registerFakeStructuredProvider([LOI_PAYLOAD]);
    cleanup = registration.unregister;

    await processLoi8K({
      cik: 62,
      accession_number: "0000000000-26-000102",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 62,
      accession_number: "62-da",
      filing_date: "2026-04-10",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2026-04-10" }],
    });

    const repo = new SpacRepo();
    const deals = await repo.getDeals(62);
    expect(deals).toHaveLength(1);
    expect(deals[0].loi_date).toBe("2026-02-01");
    expect(deals[0].definitive_agreement_date).toBe("2026-04-10");

    const spac = await repo.getSpac(62);
    expect(spac?.status).toBe("deal_announced");
    expect(spac?.loi_date).toBe("2026-02-01");
    expect(spac?.definitive_agreement_date).toBe("2026-04-10");
  });

  it("a confident negative writes nothing and auto-resolves the MODEL_EMPTY dead-letter", async () => {
    await seedSearchingSpac(63);
    const registration = registerFakeStructuredProvider([
      {
        is_loi: false,
        target_name: null,
        loi_date: null,
        confidence: 0.95,
        source_span: null,
      },
    ]);
    cleanup = registration.unregister;

    await processLoi8K({
      cik: 63,
      accession_number: "0000000000-26-000103",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacLoiExtractionRepo().getByAccession("0000000000-26-000103")
    ).toBeUndefined();
    expect((await new SpacRepo().getSpac(63))?.status).toBe("ipo");

    const dl = await new ExtractionDeadLetterRepo().get("loi", "0000000000-26-000103", "loi");
    expect(dl?.reason_code).toBe("MODEL_EMPTY");
    expect(dl?.status).toBe("resolved");

    // The run is recorded as successful, so backfill sweeps skip this filing.
    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(63, "0000000000-26-000103", "loi", "1.0.0");
    expect(run?.success).toBe(true);
  });

  it("leaves MODEL_INVALID_OUTPUT pending — a schema failure is not a 'no LOI' verdict", async () => {
    // The auto-resolve exists because "no LOI reported" is the expected answer
    // for most trigger 8-Ks. MODEL_INVALID_OUTPUT says nothing of the kind: it
    // is the section runner's catch-all for a throw it could not classify, so
    // resolving it records a filing as checked that was never read.
    await seedSearchingSpac(73);
    const registration = registerFakeStructuredProvider([
      new Error("response did not match schema"),
    ]);
    cleanup = registration.unregister;

    await processLoi8K({
      cik: 73,
      accession_number: "0000000000-26-000173",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacLoiExtractionRepo().getByAccession("0000000000-26-000173")
    ).toBeUndefined();

    const dl = await new ExtractionDeadLetterRepo().get("loi", "0000000000-26-000173", "loi");
    expect(dl?.reason_code).toBe("MODEL_INVALID_OUTPUT");
    expect(dl?.status).toBe("pending");
  });

  it("writes nothing without a trigger item", async () => {
    await seedSearchingSpac(64);
    const registration = registerFakeStructuredProvider([LOI_PAYLOAD]);
    cleanup = registration.unregister;

    await processLoi8K({
      cik: 64,
      accession_number: "0000000000-26-000104",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacLoiExtractionRepo().getByAccession("0000000000-26-000104")
    ).toBeUndefined();
    expect(registration.calls).toHaveLength(0);
  });

  it("writes nothing for a CIK with no spac row (known-SPAC gate)", async () => {
    const registration = registerFakeStructuredProvider([LOI_PAYLOAD]);
    cleanup = registration.unregister;

    await processLoi8K({
      cik: 65,
      accession_number: "0000000000-26-000105",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacLoiExtractionRepo().getByAccession("0000000000-26-000105")
    ).toBeUndefined();
    expect(registration.calls).toHaveLength(0);
  });

  it("records a failed run + dead-letter when the configured model is not registered", async () => {
    await seedSearchingSpac(66);

    await processLoi8K({
      cik: 66,
      accession_number: "0000000000-26-000106",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      // model omitted on purpose — getLoiModel() throws on the empty test repo
    });

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(66, "0000000000-26-000106", "loi", "1.0.0");
    expect(run?.success).toBe(false);
    expect(run?.error).toContain("MODEL_RESOLUTION_ERROR");

    const dl = await new ExtractionDeadLetterRepo().get("loi", "0000000000-26-000106", "loi");
    expect(dl?.reason_code).toBe("MODEL_RESOLUTION_ERROR");
  });

  it("dead-letters UNVERIFIED_SOURCE_SPAN (pending) when the cited span is not in the text", async () => {
    await seedSearchingSpac(67);
    const registration = registerFakeStructuredProvider([
      { ...LOI_PAYLOAD, source_span: "a sentence that appears nowhere in the filing" },
    ]);
    cleanup = registration.unregister;

    await processLoi8K({
      cik: 67,
      accession_number: "0000000000-26-000107",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacLoiExtractionRepo().getByAccession("0000000000-26-000107")
    ).toBeUndefined();
    const dl = await new ExtractionDeadLetterRepo().get("loi", "0000000000-26-000107", "loi");
    expect(dl?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
    expect(dl?.status).toBe("pending");
    // No loi event was emitted for the unverified claim.
    const events = await new SpacRepo().getEvents(67);
    expect(events.some((e) => e.event_type === "loi")).toBe(false);
  });

  it("is idempotent under replay", async () => {
    await seedSearchingSpac(68);
    const args = {
      cik: 68,
      accession_number: "0000000000-26-000108",
      filing_date: "2026-02-03",
      form: "8-K",
      itemCodes: ["8.01"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    } as const;

    const reg1 = registerFakeStructuredProvider([LOI_PAYLOAD]);
    await processLoi8K(args);
    reg1.unregister();

    const reg2 = registerFakeStructuredProvider([LOI_PAYLOAD]);
    cleanup = reg2.unregister;
    await processLoi8K(args);

    const repo = new SpacRepo();
    const deals = await repo.getDeals(68);
    expect(deals).toHaveLength(1);
    expect(deals[0].loi_date).toBe("2026-02-01");
    const events = await repo.getEvents(68);
    expect(events.filter((e) => e.event_type === "loi")).toHaveLength(1);
  });
});
