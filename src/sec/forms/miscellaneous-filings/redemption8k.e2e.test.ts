/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { processForm8K } from "./Form_8_K.storage";

const FULL_TXT =
  "<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-000020\n</SEC-HEADER>\n" +
  "<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n<p>Vote results.</p>\n</TEXT>\n</DOCUMENT>\n" +
  "<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n" +
  "<p>Holders of 800,000 shares elected to redeem for $8,200,000.</p>\n" +
  "</TEXT>\n</DOCUMENT>\n";

describe("processForm8K — redemption e2e", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  async function seedSpacWithDeal(cik: number): Promise<void> {
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "E2E SPAC Inc.",
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

  it("derives redemption onto deal and rolls up into spac report exactly once", async () => {
    await seedSpacWithDeal(20);
    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 800000,
        redemption_amount: 8200000,
        price_per_share: 10.25,
        confidence: 0.95,
        source_span: "800,000 shares elected to redeem for $8,200,000",
      },
    ]);
    cleanup = registration.unregister;

    await processForm8K({
      cik: 20,
      accession_number: "0000000000-26-000020",
      filing_date: "2026-03-20",
      form: "8-K",
      items: "5.07",
      report_date: "2026-03-19",
      form8K: {},
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    const deals = await new SpacRepo().getDeals(20);
    expect(deals[0].redemption_amount).toBe(8200000);

    const spacRow = await new SpacRepo().getSpac(20);
    expect(spacRow?.total_redemption_amount).toBe(8200000);
  });

  it("is idempotent — reprocessing the same 8-K does not double the redemption amount", async () => {
    await seedSpacWithDeal(20);

    const args = {
      cik: 20,
      accession_number: "0000000000-26-000020",
      filing_date: "2026-03-20",
      form: "8-K",
      items: "5.07",
      report_date: "2026-03-19",
      form8K: {},
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    } as const;

    // First call
    const reg1 = registerFakeStructuredProvider([
      {
        redemption_shares: 800000,
        redemption_amount: 8200000,
        price_per_share: 10.25,
        confidence: 0.95,
        source_span: "800,000 shares elected to redeem for $8,200,000",
      },
    ]);
    await processForm8K(args);
    reg1.unregister();

    // Second call — same accession, same payload
    const reg2 = registerFakeStructuredProvider([
      {
        redemption_shares: 800000,
        redemption_amount: 8200000,
        price_per_share: 10.25,
        confidence: 0.95,
        source_span: "800,000 shares elected to redeem for $8,200,000",
      },
    ]);
    cleanup = reg2.unregister;
    await processForm8K(args);

    const deals = await new SpacRepo().getDeals(20);
    expect(deals[0].redemption_amount).toBe(8200000);

    const spacRow = await new SpacRepo().getSpac(20);
    expect(spacRow?.total_redemption_amount).toBe(8200000);
  });

  it("known SPAC with no deal persists the orphan extraction and rolls up once the deal lands", async () => {
    // Seed SPAC row but no deal milestone — the redemption is recorded
    // anyway; deriveDeals correlates it as soon as a deal exists.
    await new SpacReportWriter().recordRegistration({
      cik: 21,
      accession_number: "21-reg",
      filing_date: "2025-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "No Deal SPAC Inc.",
      spac_sic: 6770,
    });

    const registration = registerFakeStructuredProvider([
      {
        redemption_shares: 800000,
        redemption_amount: 8200000,
        price_per_share: 10.25,
        confidence: 0.95,
        source_span: "800,000 shares elected to redeem for $8,200,000",
      },
    ]);
    cleanup = registration.unregister;

    await processForm8K({
      cik: 21,
      accession_number: "0000000000-26-000021",
      filing_date: "2026-03-20",
      form: "8-K",
      items: "5.07",
      report_date: "2026-03-19",
      form8K: {},
      fullSubmissionText: FULL_TXT,
      model: fakeS1Model(),
    });

    // No deal yet — nothing to roll up against.
    expect((await new SpacRepo().getDeals(21)).length).toBe(0);
    const orphanSpac = await new SpacRepo().getSpac(21);
    expect(orphanSpac?.total_redemption_amount ?? null).toBeNull();

    // Later, the definitive-agreement 8-K lands; the orphan extraction
    // is correlated automatically.
    await new SpacReportWriter().recordDealMilestones({
      cik: 21,
      accession_number: "21-da",
      filing_date: "2026-01-10",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2026-01-10" }],
    });

    const deals = await new SpacRepo().getDeals(21);
    expect(deals).toHaveLength(1);
    expect(deals[0].redemption_amount).toBe(8200000);

    const spacRow = await new SpacRepo().getSpac(21);
    expect(spacRow?.total_redemption_amount).toBe(8200000);
  });
});
