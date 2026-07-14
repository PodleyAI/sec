/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { deriveDeals } from "./spacDealGrouping";
import type { SpacEvent, SpacEventType } from "./SpacEventSchema";

function ev(
  event_type: SpacEventType,
  event_date: string,
  accession_number = `${event_date}-${event_type}`
): SpacEvent {
  return {
    cik: 1,
    accession_number,
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
  };
}

describe("deriveDeals — loi events", () => {
  it("an loi event opens a pending deal with loi_date", () => {
    const deals = deriveDeals(1, [ev("loi", "2026-02-01")], [], [], []);
    expect(deals).toHaveLength(1);
    expect(deals[0].loi_date).toBe("2026-02-01");
    expect(deals[0].announced_date).toBeNull();
    expect(deals[0].definitive_agreement_date).toBeNull();
    expect(deals[0].outcome).toBe("pending");
  });

  it("a later definitive agreement joins the LOI-opened deal", () => {
    const deals = deriveDeals(
      1,
      [ev("loi", "2026-02-01"), ev("definitive_agreement", "2026-04-01")],
      [],
      [],
      []
    );
    expect(deals).toHaveLength(1);
    expect(deals[0].loi_date).toBe("2026-02-01");
    expect(deals[0].definitive_agreement_date).toBe("2026-04-01");
    expect(deals[0].announced_date).toBe("2026-04-01");
  });

  it("the earliest LOI date wins on replayed / duplicate loi events", () => {
    const deals = deriveDeals(
      1,
      [ev("loi", "2026-03-01", "acc-b"), ev("loi", "2026-02-01", "acc-a")],
      [],
      [],
      []
    );
    expect(deals).toHaveLength(1);
    expect(deals[0].loi_date).toBe("2026-02-01");
  });

  it("an loi after a terminated attempt opens a new deal", () => {
    const deals = deriveDeals(
      1,
      [
        ev("definitive_agreement", "2026-01-10"),
        ev("terminated", "2026-02-15"),
        ev("loi", "2026-05-01"),
      ],
      [],
      [],
      []
    );
    expect(deals).toHaveLength(2);
    expect(deals[0].outcome).toBe("terminated");
    expect(deals[0].loi_date).toBeNull();
    expect(deals[1].loi_date).toBe("2026-05-01");
    expect(deals[1].outcome).toBe("pending");
  });

  it("post-completion loi events are operating-company noise", () => {
    const deals = deriveDeals(
      1,
      [
        ev("definitive_agreement", "2026-01-10"),
        ev("completed", "2026-06-01"),
        ev("loi", "2026-09-01"),
      ],
      [],
      [],
      []
    );
    expect(deals).toHaveLength(1);
    expect(deals[0].outcome).toBe("completed");
    expect(deals[0].loi_date).toBeNull();
  });

  it("a redemption window's boundary respects an LOI-only next deal", () => {
    // Deal 0 terminated; deal 1 opened only by an LOI. A redemption filed
    // after the LOI belongs to deal 1, not deal 0.
    const deals = deriveDeals(
      1,
      [
        ev("definitive_agreement", "2026-01-10"),
        ev("terminated", "2026-02-15"),
        ev("loi", "2026-05-01"),
      ],
      [],
      [
        {
          accession_number: "red-1",
          cik: 1,
          form: "8-K",
          filing_date: "2026-06-01",
          extractor_id: "redemption",
          extractor_version: "1.0.0",
          redemption_shares: 100,
          redemption_amount: 1000,
          price_per_share: 10,
          confidence: 0.9,
          source_span: null,
          model_id: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      []
    );
    expect(deals[0].redemption_amount).toBeNull();
    expect(deals[1].redemption_amount).toBe(1000);
  });
});
