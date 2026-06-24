/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { deriveDeals } from "./spacDealGrouping";
import type { SpacDeal } from "./SpacDealSchema";
import type { SpacEvent, SpacEventType } from "./SpacEventSchema";
import type { SpacMergerExtraction } from "./SpacMergerExtractionSchema";

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

function ext(
  accession_number: string,
  filing_date: string,
  p: Partial<SpacMergerExtraction> = {}
): SpacMergerExtraction {
  return {
    accession_number,
    cik: 1,
    form: "DEFM14A",
    filing_date,
    extractor_id: "merger-proxy",
    extractor_version: "1.0.0",
    target_name: null,
    target_cik: null,
    target_observation_id: null,
    pipe_amount: null,
    merger_consideration: null,
    confidence: 0.9,
    source_span: null,
    model_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...p,
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

describe("deriveDeals", () => {
  it("groups DA -> vote -> completion into one completed deal", () => {
    const deals = deriveDeals(
      1,
      [
        ev("definitive_agreement", "2021-03-01"),
        ev("vote", "2021-06-01"),
        ev("completed", "2021-06-15"),
      ],
      [],
      [],
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
    const deals = deriveDeals(
      1,
      [
        ev("definitive_agreement", "2021-01-01"),
        ev("terminated", "2021-02-01"),
        ev("definitive_agreement", "2021-05-01"),
        ev("completed", "2021-09-01"),
      ],
      [],
      [],
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
    const deals = deriveDeals(1, [ev("vote", "2021-04-01")], [], [], []);
    expect(deals.length).toBe(0);
  });

  it("opens an already-completed deal when 2.01 has no preceding DA", () => {
    const deals = deriveDeals(1, [ev("completed", "2021-09-01")], [], [], []);
    expect(deals.length).toBe(1);
    expect(deals[0].outcome).toBe("completed");
    expect(deals[0].announced_date).toBeNull();
    expect(deals[0].outcome_date).toBe("2021-09-01");
  });

  it("assigns the same deal_index regardless of event insertion order", () => {
    const ordered = deriveDeals(
      1,
      [
        ev("definitive_agreement", "2021-01-01"),
        ev("terminated", "2021-02-01"),
        ev("definitive_agreement", "2021-05-01"),
        ev("completed", "2021-09-01"),
      ],
      [],
      [],
      []
    );
    const shuffled = deriveDeals(
      1,
      [
        ev("completed", "2021-09-01"),
        ev("definitive_agreement", "2021-05-01"),
        ev("definitive_agreement", "2021-01-01"),
        ev("terminated", "2021-02-01"),
      ],
      [],
      [],
      []
    );
    // created_at is a wall-clock stamp for new rows; compare the derived fields.
    const strip = (ds: typeof ordered) => ds.map(({ created_at, ...rest }) => rest);
    expect(strip(shuffled)).toEqual(strip(ordered));
  });

  it("preserves created_at from an existing deal row", () => {
    const existing = [deal({ deal_index: 0, outcome: "pending", created_at: "2020-01-01T00:00:00.000Z" })];
    const deals = deriveDeals(1, [ev("definitive_agreement", "2021-03-01")], [], [], existing);
    expect(deals[0].created_at).toBe("2020-01-01T00:00:00.000Z");
  });

  it("derives target/pipe onto the deal whose window contains the proxy filing", () => {
    const deals = deriveDeals(
      1,
      [ev("definitive_agreement", "2021-03-01"), ev("completed", "2021-06-15")],
      [ext("p1", "2021-05-01", { target_name: "Acme Target Inc.", pipe_amount: 150_000_000 })],
      [],
      []
    );
    expect(deals.length).toBe(1);
    expect(deals[0].target_name).toBe("Acme Target Inc.");
    expect(deals[0].pipe_amount).toBe(150_000_000);
  });

  it("lets a definitive proxy supersede an earlier preliminary one (latest non-null wins)", () => {
    const deals = deriveDeals(
      1,
      [ev("definitive_agreement", "2021-03-01"), ev("completed", "2021-06-15")],
      [
        ext("prem", "2021-04-01", { form: "PREM14A", target_name: "Acme Target Inc.", pipe_amount: null }),
        ext("defm", "2021-05-10", { form: "DEFM14A", target_name: "Acme Target, Inc.", pipe_amount: 200_000_000 }),
      ],
      [],
      []
    );
    expect(deals[0].target_name).toBe("Acme Target, Inc."); // definitive wins
    expect(deals[0].pipe_amount).toBe(200_000_000);
  });

  it("leaves an extraction with no matching open deal unattached", () => {
    // proxy filed before any DA event -> no deal yet
    const deals = deriveDeals(1, [], [ext("p1", "2021-05-01", { target_name: "Acme" })], [], []);
    expect(deals.length).toBe(0);
  });

  it("routes two deals' proxies to the correct deal_index", () => {
    const deals = deriveDeals(
      1,
      [
        ev("definitive_agreement", "2021-01-01"),
        ev("terminated", "2021-02-15"),
        ev("definitive_agreement", "2021-05-01"),
        ev("completed", "2021-09-01"),
      ],
      [
        ext("p0", "2021-01-20", { target_name: "First Target" }),
        ext("p1", "2021-06-01", { target_name: "Second Target" }),
      ],
      [],
      []
    );
    expect(deals.map((d) => d.target_name)).toEqual(["First Target", "Second Target"]);
  });

  it("sets proxy_date from a proxy event on the open deal", () => {
    const deals = deriveDeals(
      1,
      [ev("definitive_agreement", "2021-03-01"), ev("proxy", "2021-05-20")],
      [],
      [],
      []
    );
    expect(deals[0].proxy_date).toBe("2021-05-20");
  });
});
