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
import { SpacRedemptionExtractionRepo } from "../../../storage/spac/SpacRedemptionExtractionRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../../storage/versioning/ExtractorRunSchema";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { processRedemption8K } from "./redemption8k";
import { hasRedemptionTriggerItem } from "./spac8kRedemptionTriggers";

const FULL_TXT =
  "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-000009\n</SEC-HEADER>\n" +
  "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n<p>Vote results.</p>\n</TEXT>\n</DOCUMENT>\n" +
  "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
  "<p>Holders of 1,234,567 shares elected to redeem for $12,400,000.</p>\n" +
  "</TEXT>\n</DOCUMENT>\n";

describe("processRedemption8K", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("hasRedemptionTriggerItem matches trigger codes only", () => {
    expect(hasRedemptionTriggerItem("5.07,9.01")).toBe(true);
    expect(hasRedemptionTriggerItem("2.02")).toBe(false);
    expect(hasRedemptionTriggerItem(null)).toBe(false);
  });

  async function seedSpacWithOpenDeal(cik: number): Promise<void> {
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Redeem SPAC Inc.",
      spac_sic: 6770,
    });
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-da`,
      filing_date: "2026-01-10",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2026-01-10" }],
    });
  }

  it("extracts a redemption and derives it onto the open deal", async () => {
    await seedSpacWithOpenDeal(42);
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

    await processRedemption8K({
      cik: 42,
      accession_number: "0000000000-26-000009",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    const ext = await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-000009");
    expect(ext?.redemption_amount).toBe(12400000);
    expect(ext?.redemption_shares).toBe(1234567);

    const deals = await new SpacRepo().getDeals(42);
    expect(deals[0].redemption_amount).toBe(12400000);
    expect(deals[0].redemption_shares).toBe(1234567);
  });

  it("writes nothing without a trigger item", async () => {
    await seedSpacWithOpenDeal(43);
    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 1,
        redemption_amount: 1,
        price_per_share: 10,
        confidence: 0.95,
        source_span: "elected to redeem",
      },
    ]);
    cleanup = registration.unregister;

    await processRedemption8K({
      cik: 43,
      accession_number: "0000000000-26-000010",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["9.01"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-000010")
    ).toBeUndefined();
  });

  it("writes nothing for a CIK with no spac row (gate)", async () => {
    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 1,
        redemption_amount: 1,
        price_per_share: 10,
        confidence: 0.95,
        source_span: "elected to redeem",
      },
    ]);
    cleanup = registration.unregister;

    await processRedemption8K({
      cik: 99,
      accession_number: "0000000000-26-000011",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-000011")
    ).toBeUndefined();
  });

  it("persists the extraction when the SPAC has no deals yet (orphan)", async () => {
    await new SpacReportWriter().recordRegistration({
      cik: 44,
      accession_number: "44-reg",
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Dealless SPAC Inc.",
      spac_sic: 6770,
    });
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

    await processRedemption8K({
      cik: 44,
      accession_number: "0000000000-26-000012",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    const ext = await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-000012");
    expect(ext?.redemption_amount).toBe(12400000);
    expect(ext?.redemption_shares).toBe(1234567);

    // No deal exists yet, so there's nothing to roll up onto.
    const deals = await new SpacRepo().getDeals(44);
    expect(deals).toHaveLength(0);
  });

  it("correlates an orphan redemption onto a deal added later", async () => {
    await new SpacReportWriter().recordRegistration({
      cik: 45,
      accession_number: "45-reg",
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Late Deal SPAC Inc.",
      spac_sic: 6770,
    });
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

    // Vote 8-K arrives before any definitive-agreement 8-K.
    await processRedemption8K({
      cik: 45,
      accession_number: "0000000000-26-000013",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    // Later, the definitive-agreement 8-K lands (dated earlier than the vote).
    await new SpacReportWriter().recordDealMilestones({
      cik: 45,
      accession_number: "45-da",
      filing_date: "2026-01-10",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2026-01-10" }],
    });

    const deals = await new SpacRepo().getDeals(45);
    expect(deals).toHaveLength(1);
    expect(deals[0].redemption_amount).toBe(12400000);
    expect(deals[0].redemption_shares).toBe(1234567);
  });

  it("correlates an orphan redemption onto a completed-only deal added later", async () => {
    await new SpacReportWriter().recordRegistration({
      cik: 46,
      accession_number: "46-reg",
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Completed-Only SPAC Inc.",
      spac_sic: 6770,
    });
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

    await processRedemption8K({
      cik: 46,
      accession_number: "0000000000-26-000014",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["2.01"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    // The completion (2.01) 8-K is later recorded as a milestone; no 1.01.
    await new SpacReportWriter().recordDealMilestones({
      cik: 46,
      accession_number: "46-comp",
      filing_date: "2026-03-25",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "completed", event_date: "2026-03-25" }],
    });

    const deals = await new SpacRepo().getDeals(46);
    expect(deals).toHaveLength(1);
    expect(deals[0].redemption_amount).toBe(12400000);
    expect(deals[0].redemption_shares).toBe(1234567);
  });

  it("is idempotent under replay — reprocessing before the deal lands does not double up", async () => {
    await new SpacReportWriter().recordRegistration({
      cik: 47,
      accession_number: "47-reg",
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Replay SPAC Inc.",
      spac_sic: 6770,
    });

    const args = {
      cik: 47,
      accession_number: "0000000000-26-000015",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    } as const;

    const reg1 = registerFakeStructuredProvider([
      {
        redemption_shares: 1234567,
        redemption_amount: 12400000,
        price_per_share: 10.05,
        confidence: 0.95,
        source_span: "1,234,567 shares elected to redeem for $12,400,000",
      },
    ]);
    await processRedemption8K(args);
    reg1.unregister();

    const reg2 = registerFakeStructuredProvider([
      {
        redemption_shares: 1234567,
        redemption_amount: 12400000,
        price_per_share: 10.05,
        confidence: 0.95,
        source_span: "1,234,567 shares elected to redeem for $12,400,000",
      },
    ]);
    cleanup = reg2.unregister;
    await processRedemption8K(args);

    // Now the definitive-agreement 8-K lands.
    await new SpacReportWriter().recordDealMilestones({
      cik: 47,
      accession_number: "47-da",
      filing_date: "2026-01-10",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2026-01-10" }],
    });

    const deals = await new SpacRepo().getDeals(47);
    expect(deals).toHaveLength(1);
    expect(deals[0].redemption_amount).toBe(12400000);
    expect(deals[0].redemption_shares).toBe(1234567);
  });

  describe("extractor_runs recording", () => {
    it("records a successful run after a clean extraction", async () => {
      await seedSpacWithOpenDeal(50);
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

      await processRedemption8K({
        cik: 50,
        accession_number: "0000000000-26-000050",
        filing_date: "2026-03-20",
        form: "8-K",
        itemCodes: ["5.07"],
        fullSubmissionText: FULL_TXT,
        model: fakeS1Model(),
      });

      const runRepo = new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      );
      const run = await runRepo.findRun(50, "0000000000-26-000050", "redemption", "1.0.0");
      expect(run?.success).toBe(true);
      expect(run?.error).toBeNull();
      expect(run?.slot_at_run).toBe("current");
    });

    it("records a successful run when the SPAC has no deals (orphan)", async () => {
      await new SpacReportWriter().recordRegistration({
        cik: 51,
        accession_number: "51-reg",
        filing_date: "2025-12-01",
        form: "S-1",
        primary_document: "s1.htm",
        spac_name: "Orphan SPAC Inc.",
        spac_sic: 6770,
      });
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

      await processRedemption8K({
        cik: 51,
        accession_number: "0000000000-26-000051",
        filing_date: "2026-03-20",
        form: "8-K",
        itemCodes: ["5.07"],
        fullSubmissionText: FULL_TXT,
        model: fakeS1Model(),
      });

      const runRepo = new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      );
      const run = await runRepo.findRun(51, "0000000000-26-000051", "redemption", "1.0.0");
      expect(run?.success).toBe(true);
      expect(run?.error).toBeNull();
    });

    it("does NOT record a run when the trigger-item gate skips the filing", async () => {
      await seedSpacWithOpenDeal(53);

      await processRedemption8K({
        cik: 53,
        accession_number: "0000000000-26-000053",
        filing_date: "2026-03-20",
        form: "8-K",
        itemCodes: ["2.02"],
        fullSubmissionText: FULL_TXT,
        model: fakeS1Model(),
      });

      const runRepo = new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      );
      const run = await runRepo.findRun(53, "0000000000-26-000053", "redemption", "1.0.0");
      expect(run).toBeUndefined();
    });

    it("does NOT record a run when the SPAC gate skips the filing", async () => {
      // No spac row seeded for cik 54.
      await processRedemption8K({
        cik: 54,
        accession_number: "0000000000-26-000054",
        filing_date: "2026-03-20",
        form: "8-K",
        itemCodes: ["5.07"],
        fullSubmissionText: FULL_TXT,
        model: fakeS1Model(),
      });

      const runRepo = new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      );
      const run = await runRepo.findRun(54, "0000000000-26-000054", "redemption", "1.0.0");
      expect(run).toBeUndefined();
    });

    it("records a failed run + dead-letter when the configured model is not registered", async () => {
      await seedSpacWithOpenDeal(55);
      // Deliberately do NOT register a fake model and do NOT pass args.model
      // — getRedemptionModel() will throw "not registered" against the empty
      // test model repository.
      await processRedemption8K({
        cik: 55,
        accession_number: "0000000000-26-000055",
        filing_date: "2026-03-20",
        form: "8-K",
        itemCodes: ["5.07"],
        fullSubmissionText: FULL_TXT,
        // model omitted on purpose
      });

      const runRepo = new ExtractorRunRepo(
        globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
      );
      const run = await runRepo.findRun(55, "0000000000-26-000055", "redemption", "1.0.0");
      expect(run?.success).toBe(false);
      expect(run?.error).toContain("MODEL_RESOLUTION_ERROR");

      // No extraction row was persisted.
      expect(
        await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-000055")
      ).toBeUndefined();
    });
  });

  it("drops every exhibit when each exceeds the per-exhibit cap and records OVERSIZED_INPUT", async () => {
    await seedSpacWithOpenDeal(50);
    // Build a submission whose primary and EX-99 each exceed the 200k cap.
    // Each <p> body has > 250k chars of repeated filler.
    const filler = "A".repeat(260_000);
    const oversizedTxt =
      "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-OVER01\n</SEC-HEADER>\n" +
      "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n" +
      `<p>${filler}</p>\n` +
      "</TEXT>\n</DOCUMENT>\n" +
      "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
      `<p>${filler}</p>\n` +
      "</TEXT>\n</DOCUMENT>\n";

    let modelInvocations = 0;
    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 1,
        redemption_amount: 1,
        price_per_share: 10,
        confidence: 0.99,
        source_span: "should never be reached",
      },
    ]);
    cleanup = () => {
      registration.unregister();
    };
    // The fake provider tracks calls via its `calls` array.
    const baseLen = registration.calls.length;

    await processRedemption8K({
      cik: 50,
      accession_number: "0000000000-26-OVER01",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: oversizedTxt,
      model: fakeS1Model(),
    });

    modelInvocations = registration.calls.length - baseLen;
    expect(modelInvocations).toBe(0);

    expect(
      await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-OVER01")
    ).toBeUndefined();

    const dl = await new ExtractionDeadLetterRepo().get(
      "redemption",
      "0000000000-26-OVER01",
      "redemption"
    );
    expect(dl?.reason_code).toBe("OVERSIZED_INPUT");
  });

  it("records a successful run on full-drop so the backfill sweep stays idempotent", async () => {
    await seedSpacWithOpenDeal(56);
    const filler = "A".repeat(260_000);
    const oversizedTxt =
      "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-000056\n</SEC-HEADER>\n" +
      "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n" +
      `<p>${filler}</p>\n` +
      "</TEXT>\n</DOCUMENT>\n" +
      "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
      `<p>${filler}</p>\n` +
      "</TEXT>\n</DOCUMENT>\n";
    const registration = registerFakeStructuredProvider([]);
    cleanup = registration.unregister;

    await processRedemption8K({
      cik: 56,
      accession_number: "0000000000-26-000056",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: oversizedTxt,
      model: fakeS1Model(),
    });

    // The OVERSIZED_INPUT dead-letter is recorded (pending, for triage).
    const dl = await new ExtractionDeadLetterRepo().get(
      "redemption",
      "0000000000-26-000056",
      "redemption"
    );
    expect(dl?.reason_code).toBe("OVERSIZED_INPUT");

    // ...but a SUCCESSFUL run is also recorded, so the deterministic-cap drop is
    // idempotent: listFilingsWithoutSuccessfulRun excludes this filing and the
    // backfill sweep no longer re-fetches/re-drops the oversized submission.
    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const run = await runRepo.findRun(56, "0000000000-26-000056", "redemption", "1.0.0");
    expect(run?.success).toBe(true);
  });

  it("proceeds with surviving exhibits when one is dropped and records a partial-oversized dead-letter", async () => {
    await seedSpacWithOpenDeal(51);
    // Primary doc is small + has the canonical sentence; EX-99.2 is oversized
    // and gets dropped. Extraction must still succeed on the survivors.
    const filler = "B".repeat(260_000);
    const partialTxt =
      "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-PART01\n</SEC-HEADER>\n" +
      "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n" +
      "<p>Holders of 5,000,000 shares elected to redeem for $50,000,000.</p>\n" +
      "</TEXT>\n</DOCUMENT>\n" +
      "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
      `<p>${filler}</p>\n` +
      "</TEXT>\n</DOCUMENT>\n";

    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 5_000_000,
        redemption_amount: 50_000_000,
        price_per_share: 10.0,
        confidence: 0.95,
        source_span: "5,000,000 shares elected to redeem for $50,000,000",
      },
    ]);
    cleanup = registration.unregister;

    await processRedemption8K({
      cik: 51,
      accession_number: "0000000000-26-PART01",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: partialTxt,
      model: fakeS1Model(),
    });

    // Extraction proceeded with the surviving primary doc.
    const ext = await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-PART01");
    expect(ext?.redemption_amount).toBe(50_000_000);

    // Partial-oversized informational dead-letter recorded — and auto-resolved
    // (no retry recovers a deterministic-cap drop).
    const dlRepo = new ExtractionDeadLetterRepo();
    const partial = await dlRepo.get(
      "redemption",
      "0000000000-26-PART01",
      "redemption-partial-oversized"
    );
    expect(partial?.reason_code).toBe("OVERSIZED_INPUT");
    expect(partial?.status).toBe("resolved");
  });

  it("auto-resolves the partial-oversized dead-letter across replays — never appears in listEligible", async () => {
    await seedSpacWithOpenDeal(53);
    // Same shape as the partial-oversized test: small primary doc with the
    // canonical sentence + an EX-99 over the cap that gets dropped.
    const filler = "D".repeat(260_000);
    const partialTxt =
      "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-RES001\n</SEC-HEADER>\n" +
      "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n" +
      "<p>Holders of 7,500,000 shares elected to redeem for $75,000,000.</p>\n" +
      "</TEXT>\n</DOCUMENT>\n" +
      "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
      `<p>${filler}</p>\n` +
      "</TEXT>\n</DOCUMENT>\n";
    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 7_500_000,
        redemption_amount: 75_000_000,
        price_per_share: 10.0,
        confidence: 0.95,
        source_span: "7,500,000 shares elected to redeem for $75,000,000",
      },
      // Second-run replay produces the same row.
      {
        redemption_shares: 7_500_000,
        redemption_amount: 75_000_000,
        price_per_share: 10.0,
        confidence: 0.95,
        source_span: "7,500,000 shares elected to redeem for $75,000,000",
      },
    ]);
    cleanup = registration.unregister;

    const dlRepo = new ExtractionDeadLetterRepo();
    const sectionKey = "redemption-partial-oversized";

    // Run #1: record + auto-resolve.
    await processRedemption8K({
      cik: 53,
      accession_number: "0000000000-26-RES001",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: partialTxt,
      model: fakeS1Model(),
    });

    let entry = await dlRepo.get("redemption", "0000000000-26-RES001", sectionKey);
    expect(entry?.status).toBe("resolved");
    // `attempts` counts CONSECUTIVE failures of the current
    // (reason_code, version) pair, and this run resolved — so the streak is
    // over and the counter is 0, not a running tally of how many times the
    // entry was ever recorded. The bounded same-version retry spends this
    // counter, so it has to mean "how many times has THIS failure repeated
    // without a clean run", which a lifetime tally cannot answer.
    expect(entry?.attempts).toBe(0);

    // The current extractor version must be derivable; we use the version on the
    // recorded entry itself as the source of truth.
    const currentVersion = entry!.failed_extractor_version;
    let eligible = await dlRepo.listEligible("redemption", currentVersion);
    expect(
      eligible.filter(
        (e) => e.section_name === sectionKey && e.accession_number === "0000000000-26-RES001"
      )
    ).toHaveLength(0);

    // Run #2: idempotent — the entry stays resolved and listEligible still
    // excludes it. `attempts` does NOT accumulate across replays: each run
    // re-records (streak restarts at 1) and then resolves (back to 0), so a
    // filing that keeps auto-resolving never drifts toward the retry bound.
    await processRedemption8K({
      cik: 53,
      accession_number: "0000000000-26-RES001",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: partialTxt,
      model: fakeS1Model(),
    });

    entry = await dlRepo.get("redemption", "0000000000-26-RES001", sectionKey);
    expect(entry?.status).toBe("resolved");
    expect(entry?.attempts).toBe(0);
    eligible = await dlRepo.listEligible("redemption", currentVersion);
    expect(
      eligible.filter(
        (e) => e.section_name === sectionKey && e.accession_number === "0000000000-26-RES001"
      )
    ).toHaveLength(0);
  });

  it("extracts successfully with a moderately large EX-99 (~150 KB)", async () => {
    await seedSpacWithOpenDeal(52);
    // 150 KB filler stays under the 200 KB per-exhibit cap; the canonical
    // sentence still extracts cleanly. Integration baseline that the cap
    // does not regress reasonable filing sizes.
    const filler = "C".repeat(150_000);
    const okTxt =
      "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-OK0001\n</SEC-HEADER>\n" +
      "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n" +
      "<p>Vote results.</p>\n" +
      "</TEXT>\n</DOCUMENT>\n" +
      "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
      `<p>${filler}</p>\n` +
      "<p>Holders of 2,500,000 shares elected to redeem for $25,000,000.</p>\n" +
      "</TEXT>\n</DOCUMENT>\n";

    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 2_500_000,
        redemption_amount: 25_000_000,
        price_per_share: 10.0,
        confidence: 0.95,
        source_span: "2,500,000 shares elected to redeem for $25,000,000",
      },
    ]);
    cleanup = registration.unregister;

    await processRedemption8K({
      cik: 52,
      accession_number: "0000000000-26-OK0001",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: okTxt,
      model: fakeS1Model(),
    });

    const ext = await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-OK0001");
    expect(ext?.redemption_amount).toBe(25_000_000);

    // No OVERSIZED_INPUT dead-letter was recorded.
    const dl = await new ExtractionDeadLetterRepo().get(
      "redemption",
      "0000000000-26-OK0001",
      "redemption-partial-oversized"
    );
    expect(dl).toBeUndefined();
  });
});
