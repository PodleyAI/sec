/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { SpacRedemptionExtractionRepo } from "../../../storage/spac/SpacRedemptionExtractionRepo";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { hasRedemptionTriggerItem } from "./spac8kRedemptionTriggers";
import { processRedemption8K } from "./redemption8k";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";

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

  it("does not extract when the SPAC has no deals", async () => {
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
        redemption_shares: 1,
        redemption_amount: 1,
        price_per_share: 10,
        confidence: 0.95,
        source_span: "elected to redeem",
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

    expect(
      await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-000012")
    ).toBeUndefined();
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
    expect(entry?.attempts).toBe(1);

    // The current extractor version must be derivable; we use the version on the
    // recorded entry itself as the source of truth.
    const currentVersion = entry!.failed_extractor_version;
    let eligible = await dlRepo.listEligible("redemption", currentVersion);
    expect(
      eligible.filter((e) => e.section_name === sectionKey && e.accession_number === "0000000000-26-RES001")
    ).toHaveLength(0);

    // Run #2: idempotent — the entry stays resolved, attempts increments (audit
    // trail), and listEligible still excludes it.
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
    expect(entry?.attempts).toBe(2);
    eligible = await dlRepo.listEligible("redemption", currentVersion);
    expect(
      eligible.filter((e) => e.section_name === sectionKey && e.accession_number === "0000000000-26-RES001")
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
