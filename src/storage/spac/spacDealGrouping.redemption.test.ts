/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { deriveDeals } from "./spacDealGrouping";
import type { SpacEvent } from "./SpacEventSchema";
import type { SpacRedemptionExtraction } from "./SpacRedemptionExtractionSchema";

const ev = (event_type: string, event_date: string, acc: string): SpacEvent =>
  ({
    cik: 1,
    accession_number: acc,
    event_type,
    event_date,
    form: "8-K",
    primary_document: null,
    source_document_url: null,
    deal_index: null,
    amount: null,
    shares: null,
    detail: null,
    confidence: null,
    created_at: "2026-01-01T00:00:00.000Z",
  }) as unknown as SpacEvent;

const red = (
  acc: string,
  filing_date: string,
  shares: number | null,
  amount: number | null
): SpacRedemptionExtraction => ({
  accession_number: acc,
  cik: 1,
  form: "8-K",
  filing_date,
  extractor_id: "redemption",
  extractor_version: "1.0.0",
  redemption_shares: shares,
  redemption_amount: amount,
  price_per_share: null,
  confidence: 0.9,
  source_span: "x",
  model_id: "fake",
  created_at: "2026-01-01T00:00:00.000Z",
});

describe("deriveDeals redemption correlation", () => {
  it("attaches a redemption filed at/after the deal's completion date", () => {
    const events = [
      ev("definitive_agreement", "2026-01-10", "da-1"),
      ev("completed", "2026-03-20", "close-1"),
    ];
    const deals = deriveDeals(1, events, [], [red("r-1", "2026-03-20", 500000, 5_100_000)], []);
    expect(deals).toHaveLength(1);
    expect(deals[0].redemption_amount).toBe(5_100_000);
    expect(deals[0].redemption_shares).toBe(500000);
  });

  it("buckets redemptions by announcement window across two deals", () => {
    const events = [
      ev("definitive_agreement", "2026-01-10", "da-1"),
      ev("terminated", "2026-02-15", "term-1"),
      ev("definitive_agreement", "2026-04-01", "da-2"),
      ev("completed", "2026-06-01", "close-2"),
    ];
    const reds = [red("r-1", "2026-02-10", 100, 1000), red("r-2", "2026-06-01", 200, 2000)];
    const deals = deriveDeals(1, events, [], reds, []);
    expect(deals[0].redemption_amount).toBe(1000);
    expect(deals[1].redemption_amount).toBe(2000);
  });

  it("latest redemption filing wins; non-null survives a later null", () => {
    const events = [ev("definitive_agreement", "2026-01-10", "da-1")];
    const reds = [red("r-1", "2026-03-01", 100, 1000), red("r-2", "2026-03-05", 150, null)];
    const deals = deriveDeals(1, events, [], reds, []);
    expect(deals[0].redemption_shares).toBe(150);
    expect(deals[0].redemption_amount).toBe(1000);
  });

  it("leaves redemptions unattached when there is no deal", () => {
    const deals = deriveDeals(1, [], [], [red("r-1", "2026-03-01", 100, 1000)], []);
    expect(deals).toEqual([]);
  });

  it("attaches a vote-results redemption filed before a completion-only deal's date", () => {
    // A SPAC whose only ingested milestone is the completion 8-K (no 1.01 DA);
    // the `vote` event opens no deal, so the deal is opened solely by `completed`
    // and its only date is the later outcome_date. A redemption reported at the
    // vote (filed before closing) must still attach to that single deal.
    const events = [ev("vote", "2026-03-19", "vote-1"), ev("completed", "2026-03-20", "close-1")];
    const deals = deriveDeals(1, events, [], [red("r-1", "2026-03-19", 400000, 4_000_000)], []);
    expect(deals).toHaveLength(1);
    expect(deals[0].redemption_amount).toBe(4_000_000);
    expect(deals[0].redemption_shares).toBe(400000);
  });
});
