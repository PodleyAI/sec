/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { SpacRedemptionExtractionRepo } from "../../../storage/spac/SpacRedemptionExtractionRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { MAX_STORED_SPAN_CHARS } from "../registration-statements/s1/verifySourceSpan";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { processRedemption8K } from "./redemption8k";

const FULL_TXT =
  "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-injection\n</SEC-HEADER>\n" +
  "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n<p>Vote results.</p>\n</TEXT>\n</DOCUMENT>\n" +
  "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
  "<p>Holders of 1,234,567 shares elected to redeem for $12,400,000.</p>\n" +
  "</TEXT>\n</DOCUMENT>\n";

async function seedSpacWithDeal(cik: number): Promise<void> {
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

describe("processRedemption8K prompt-injection seal", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("verifyRowSpan rejects a 1001-char source_span at the gate and dead-letters UNVERIFIED_SOURCE_SPAN", async () => {
    await seedSpacWithDeal(800);
    const oversizedSpan = "X".repeat(MAX_STORED_SPAN_CHARS + 1);
    expect(oversizedSpan.length).toBe(1001);
    const { unregister } = registerFakeStructuredProvider([
      {
        redemption_shares: 999,
        redemption_amount: 999,
        price_per_share: 1,
        confidence: 0.99,
        source_span: oversizedSpan,
      },
    ]);
    cleanup = unregister;

    await processRedemption8K({
      cik: 800,
      accession_number: "0000000000-26-injection",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-injection")
    ).toBeUndefined();
    const dl = await new ExtractionDeadLetterRepo().listPending("redemption");
    const red = dl.find((d) => d.section_name === "redemption");
    expect(red?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
  });

  it("a wrong nonce_seen dead-letters NONCE_MISMATCH and persists nothing", async () => {
    await seedSpacWithDeal(802);
    // The canned payload sets `nonce_seen` to a valid-shaped but WRONG value,
    // bypassing the fake provider's preamble-token auto-echo. `verifyNonce`
    // inside extractRedemption throws NonceMismatchError, which
    // `sectionRunner` records under the dedicated `NONCE_MISMATCH` reason.
    const { unregister } = registerFakeStructuredProvider([
      {
        redemption_shares: 1234567,
        redemption_amount: 12400000,
        price_per_share: 10.05,
        confidence: 0.99,
        source_span: "1,234,567 shares elected to redeem for $12,400,000",
        nonce_seen: "deadbeefdeadbeef",
      },
    ]);
    cleanup = unregister;

    await processRedemption8K({
      cik: 802,
      accession_number: "0000000000-26-injection-3",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    expect(
      await new SpacRedemptionExtractionRepo().getByAccession("0000000000-26-injection-3")
    ).toBeUndefined();
    const dl = await new ExtractionDeadLetterRepo().listPending("redemption");
    const red = dl.find((d) => d.section_name === "redemption");
    expect(red?.reason_code).toBe("NONCE_MISMATCH");
  });

  it("persist site caps the stored source_span via boundSourceSpan at MAX_STORED_SPAN_CHARS", async () => {
    await seedSpacWithDeal(801);
    // A verbatim span from the EX-99.1 narrative persists unchanged.
    const verbatim = "1,234,567 shares elected to redeem for $12,400,000";
    expect(verbatim.length).toBeLessThanOrEqual(MAX_STORED_SPAN_CHARS);
    const { unregister } = registerFakeStructuredProvider([
      {
        redemption_shares: 1234567,
        redemption_amount: 12400000,
        price_per_share: 10.05,
        confidence: 0.95,
        source_span: verbatim,
      },
    ]);
    cleanup = unregister;

    await processRedemption8K({
      cik: 801,
      accession_number: "0000000000-26-injection-2",
      filing_date: "2026-03-20",
      form: "8-K",
      itemCodes: ["5.07"],
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    const ext = await new SpacRedemptionExtractionRepo().getByAccession(
      "0000000000-26-injection-2"
    );
    expect(ext).toBeDefined();
    expect((ext?.source_span ?? "").length).toBeLessThanOrEqual(MAX_STORED_SPAN_CHARS);
    expect(ext?.source_span).toBe(verbatim);
  });
});
