/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { deriveDealsFromEvents } from "./spacDealGrouping";
import type { SpacDeal } from "./SpacDealSchema";
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

function deal(p: Pick<SpacDeal, "deal_index" | "outcome"> & Partial<SpacDeal>): SpacDeal {
  return {
    cik: 1,
    target_name: null,
    target_cik: null,
    announced_date: null,
    definitive_agreement_date: null,
    proxy_date: null,
    vote_date: null,
    pipe_amount: null,
    redemption_amount: null,
    redemption_shares: null,
    outcome_date: null,
    source_accession: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("deriveDealsFromEvents", () => {
  it("groups DA -> vote -> completion into one completed deal", () => {
    const deals = deriveDealsFromEvents(
      1,
      [
        ev("definitive_agreement", "2021-03-01"),
        ev("vote", "2021-06-01"),
        ev("completed", "2021-06-15"),
      ],
      []
    );
    expect(deals.length).toBe(1);
    expect(deals[0].deal_index).toBe(0);
    expect(deals[0].outcome).toBe("completed");
    expect(deals[0].announced_date).toBe("2021-03-01");
    expect(deals[0].definitive_agreement_date).toBe("2021-03-01");
    expect(deals[0].vote_date).toBe("2021-06-01");
    expect(deals[0].outcome_date).toBe("2021-06-15");
  });

  it("splits a terminated attempt and a later completed attempt into two deals", () => {
    const deals = deriveDealsFromEvents(
      1,
      [
        ev("definitive_agreement", "2021-01-01"),
        ev("terminated", "2021-02-01"),
        ev("definitive_agreement", "2021-05-01"),
        ev("completed", "2021-09-01"),
      ],
      []
    );
    expect(deals.map((d) => d.deal_index)).toEqual([0, 1]);
    expect(deals[0].outcome).toBe("terminated");
    expect(deals[0].outcome_date).toBe("2021-02-01");
    expect(deals[1].outcome).toBe("completed");
    expect(deals[1].announced_date).toBe("2021-05-01");
    expect(deals[1].outcome_date).toBe("2021-09-01");
  });

  it("ignores an extension vote with no open deal", () => {
    const deals = deriveDealsFromEvents(1, [ev("vote", "2021-04-01")], []);
    expect(deals.length).toBe(0);
  });

  it("opens an already-completed deal when 2.01 has no preceding DA", () => {
    const deals = deriveDealsFromEvents(1, [ev("completed", "2021-09-01")], []);
    expect(deals.length).toBe(1);
    expect(deals[0].outcome).toBe("completed");
    expect(deals[0].announced_date).toBeNull();
    expect(deals[0].outcome_date).toBe("2021-09-01");
  });

  it("assigns the same deal_index regardless of event insertion order", () => {
    const ordered = deriveDealsFromEvents(
      1,
      [
        ev("definitive_agreement", "2021-01-01"),
        ev("terminated", "2021-02-01"),
        ev("definitive_agreement", "2021-05-01"),
        ev("completed", "2021-09-01"),
      ],
      []
    );
    const shuffled = deriveDealsFromEvents(
      1,
      [
        ev("completed", "2021-09-01"),
        ev("definitive_agreement", "2021-05-01"),
        ev("definitive_agreement", "2021-01-01"),
        ev("terminated", "2021-02-01"),
      ],
      []
    );
    expect(shuffled).toEqual(ordered);
  });

  it("merge-preserves AI-enriched fields not owned by 8-K", () => {
    const existing = [
      deal({
        deal_index: 0,
        outcome: "pending",
        target_name: "Acme Target Inc.",
        target_cik: 99,
        pipe_amount: 150_000_000,
        proxy_date: "2021-05-20",
        created_at: "2020-01-01T00:00:00.000Z",
      }),
    ];
    const deals = deriveDealsFromEvents(
      1,
      [ev("definitive_agreement", "2021-03-01"), ev("completed", "2021-06-15")],
      existing
    );
    expect(deals.length).toBe(1);
    expect(deals[0].outcome).toBe("completed");
    expect(deals[0].outcome_date).toBe("2021-06-15");
    expect(deals[0].target_name).toBe("Acme Target Inc.");
    expect(deals[0].target_cik).toBe(99);
    expect(deals[0].pipe_amount).toBe(150_000_000);
    expect(deals[0].proxy_date).toBe("2021-05-20");
    expect(deals[0].created_at).toBe("2020-01-01T00:00:00.000Z");
  });
});
