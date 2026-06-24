/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { SpacRedemptionExtractionRepo } from "../../../storage/spac/SpacRedemptionExtractionRepo";
import { ExtractorRunRepo } from "../../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../../storage/versioning/ExtractorRunSchema";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { hasRedemptionTriggerItem } from "./spac8kRedemptionTriggers";
import { processRedemption8K } from "./redemption8k";

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
  });
});
