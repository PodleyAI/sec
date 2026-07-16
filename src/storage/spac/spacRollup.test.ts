/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { SpacDeal } from "./SpacDealSchema";
import type { SpacEvent } from "./SpacEventSchema";
import { buildSpacRow } from "./spacRollup";

function ev(p: Pick<SpacEvent, "event_type" | "event_date"> & Partial<SpacEvent>): SpacEvent {
  return {
    cik: 1,
    accession_number: p.event_date + "-" + p.event_type,
    form: null,
    primary_document: null,
    source_document_url: null,
    deal_index: null,
    amount: null,
    shares: null,
    detail: null,
    confidence: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

function deal(p: Pick<SpacDeal, "deal_index" | "outcome"> & Partial<SpacDeal>): SpacDeal {
  return {
    cik: 1,
    target_name: null,
    target_cik: null,
    target_description: null,
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

describe("buildSpacRow", () => {
  it("derives registration + ipo dates and status from events", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "registration", event_date: "2020-12-01" }),
        ev({ event_type: "ipo", event_date: "2021-01-15" }),
      ],
      patch: { spac_name: "Foo SPAC", spac_sic: 6770 },
      filingDate: "2021-01-15",
    });
    expect(row.registration_date).toBe("2020-12-01");
    expect(row.ipo_date).toBe("2021-01-15");
    expect(row.status).toBe("ipo");
    expect(row.spac_name).toBe("Foo SPAC");
    expect(row.current_name).toBe("Foo SPAC"); // mirrors spac_name pre-merger
    expect(row.as_of).toBe("2021-01-15");
  });

  it("derives surviving_name from a completed deal's target (de-SPAC linkage)", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          target_name: "Lucid Motors, Inc.",
          outcome_date: "2021-07-23",
        }),
      ],
      events: [
        ev({ event_type: "registration", event_date: "2020-04-30" }),
        ev({ event_type: "completed", event_date: "2021-07-23" }),
      ],
      patch: { spac_name: "Churchill Capital Corp IV", spac_sic: 6770 },
      filingDate: "2021-07-23",
    });
    expect(row.status).toBe("completed");
    expect(row.completed_date).toBe("2021-07-23");
    // The combined entity is named after the target; current_name mirrors it.
    expect(row.surviving_name).toBe("Lucid Motors, Inc.");
    expect(row.current_name).toBe("Lucid Motors, Inc.");
    // The shell name is preserved on the SPAC-era column.
    expect(row.spac_name).toBe("Churchill Capital Corp IV");
  });

  it("an explicit surviving_name patch (entity-sourced) overrides the deal target", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          target_name: "Target Co",
          outcome_date: "2021-06-15",
        }),
      ],
      events: [ev({ event_type: "completed", event_date: "2021-06-15" })],
      patch: {
        spac_name: "Shell SPAC",
        surviving_name: "Renamed NewCo Inc",
        post_merger_sic: 3711,
      },
      filingDate: "2021-06-15",
    });
    expect(row.surviving_name).toBe("Renamed NewCo Inc");
    expect(row.surviving_name_source).toBe("entity");
    expect(row.current_name).toBe("Renamed NewCo Inc");
    expect(row.post_merger_sic).toBe(3711);
    expect(row.current_sic).toBe(3711);
  });

  it("re-derives a deal-sourced surviving_name when a later proxy supersedes the target", () => {
    // The rollup persists its own derived fallback, so on the next rebuild it
    // must NOT read that back as an explicit value — a definitive proxy that
    // corrects target_name has to be able to refresh it.
    const existing = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          target_name: "Acme Holdings",
          outcome_date: "2021-06-15",
        }),
      ],
      events: [ev({ event_type: "completed", event_date: "2021-06-15" })],
      patch: { spac_name: "Shell SPAC" },
      filingDate: "2021-06-15",
    });
    expect(existing.surviving_name).toBe("Acme Holdings");
    expect(existing.surviving_name_source).toBe("deal-target");

    const rebuilt = buildSpacRow({
      existing,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          target_name: "Acme Corporation",
          outcome_date: "2021-06-15",
        }),
      ],
      events: [ev({ event_type: "completed", event_date: "2021-06-15" })],
      patch: {},
      filingDate: "2021-06-20",
    });
    expect(rebuilt.surviving_name).toBe("Acme Corporation");
    expect(rebuilt.current_name).toBe("Acme Corporation");
  });

  it("preserves an entity-sourced surviving_name against a later deal-target change", () => {
    const existing = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          target_name: "Acme Holdings",
          outcome_date: "2021-06-15",
        }),
      ],
      events: [ev({ event_type: "completed", event_date: "2021-06-15" })],
      patch: { spac_name: "Shell SPAC", surviving_name: "Acme Corporation Inc." },
      filingDate: "2021-06-15",
    });
    expect(existing.surviving_name_source).toBe("entity");

    const rebuilt = buildSpacRow({
      existing,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          target_name: "Renamed Target",
          outcome_date: "2021-06-15",
        }),
      ],
      events: [ev({ event_type: "completed", event_date: "2021-06-15" })],
      patch: {},
      filingDate: "2021-06-20",
    });
    // The close-time entity snapshot wins: it is the real surviving name.
    expect(rebuilt.surviving_name).toBe("Acme Corporation Inc.");
    expect(rebuilt.surviving_name_source).toBe("entity");
  });

  it("leaves surviving_name null for a still-pending deal", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "pending",
          target_name: "Target Co",
          announced_date: "2021-05-01",
        }),
      ],
      events: [ev({ event_type: "definitive_agreement", event_date: "2021-05-01" })],
      patch: { spac_name: "Shell SPAC" },
      filingDate: "2021-05-01",
    });
    expect(row.status).toBe("deal_announced");
    expect(row.surviving_name).toBeNull();
    expect(row.current_name).toBe("Shell SPAC");
  });

  it("merges narrative enrichment scalars from the patch", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "registration", event_date: "2021-01-01" })],
      patch: {
        spac_name: "Foo SPAC",
        spac_sic: 6770,
        focus: JSON.stringify(["FinTech", "Healthcare"]),
        focus_location: JSON.stringify(["North America"]),
        description: "A blank-check company.",
        team: "Seasoned operators.",
        url_spac: "https://foo.example",
      },
      filingDate: "2021-01-01",
    });
    expect(row.focus).toBe(JSON.stringify(["FinTech", "Healthcare"]));
    expect(row.focus_location).toBe(JSON.stringify(["North America"]));
    expect(row.description).toBe("A blank-check company.");
    expect(row.team).toBe("Seasoned operators.");
    expect(row.url_spac).toBe("https://foo.example");
    // Editorial-only columns default null (no patch source).
    expect(row.url_sponsor).toBeNull();
    expect(row.details).toBeNull();
  });

  it("a stale filing may fill a null narrative slot but never clobbers a set value", () => {
    const existing = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "registration", event_date: "2021-06-01" })],
      patch: { description: "Original description", focus: JSON.stringify(["Energy"]) },
      filingDate: "2021-06-01",
    });
    // An OLDER filing (stale) carrying a different description + a new team blurb.
    const replay = buildSpacRow({
      existing,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "registration", event_date: "2021-01-01" })],
      patch: { description: "Stale description", team: "Team blurb" },
      filingDate: "2021-01-01",
    });
    // Non-null existing value preserved; null slot (team) filled by the stale filing.
    expect(replay.description).toBe("Original description");
    expect(replay.focus).toBe(JSON.stringify(["Energy"]));
    expect(replay.team).toBe("Team blurb");
    expect(replay.as_of).toBe("2021-06-01"); // anchor never regresses
  });

  it("a newer filing not carrying a narrative field preserves the prior value (merge, not erase)", () => {
    const existing = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "registration", event_date: "2021-01-01" })],
      patch: { description: "Set once", url_spac: "https://foo.example" },
      filingDate: "2021-01-01",
    });
    const later = buildSpacRow({
      existing,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "ipo", event_date: "2021-03-01" })],
      patch: { ipo_proceeds: 100 }, // no narrative fields
      filingDate: "2021-03-01",
    });
    expect(later.description).toBe("Set once");
    expect(later.url_spac).toBe("https://foo.example");
    expect(later.ipo_proceeds).toBe(100);
  });

  it("derives investorpres_url/date from the latest investor_presentation event", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "ipo", event_date: "2021-01-15" }),
        ev({
          event_type: "investor_presentation",
          event_date: "2021-06-01",
          source_document_url: "https://sec.gov/old-deck.htm",
        }),
        ev({
          event_type: "investor_presentation",
          event_date: "2021-09-01",
          source_document_url: "https://sec.gov/new-deck.htm",
        }),
      ],
      patch: {},
      filingDate: "2021-09-01",
    });
    expect(row.investorpres_url).toBe("https://sec.gov/new-deck.htm"); // latest wins
    expect(row.investorpres_date).toBe("2021-09-01");
  });

  it("leaves investorpres null when no investor_presentation event exists", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: {},
      filingDate: "2021-01-15",
    });
    expect(row.investorpres_url).toBeNull();
    expect(row.investorpres_date).toBeNull();
  });

  it("earliest registration event wins for registration_date", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "registration", event_date: "2021-02-01" }),
        ev({ event_type: "registration", event_date: "2020-12-01" }),
      ],
      patch: {},
      filingDate: "2021-02-01",
    });
    expect(row.registration_date).toBe("2020-12-01");
  });

  it("a terminated deal's milestones never shadow the active pending deal", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "terminated",
          target_name: "Dead Co",
          definitive_agreement_date: "2022-01-01",
          proxy_date: "2022-03-01",
        }),
        deal({
          deal_index: 1,
          outcome: "pending",
          target_name: "Live Co",
          announced_date: "2022-06-01",
          definitive_agreement_date: "2022-07-01",
        }),
      ],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: {},
      filingDate: "2022-07-01",
    });
    expect(row.target_name).toBe("Live Co");
    expect(row.definitive_agreement_date).toBe("2022-07-01");
    expect(row.proxy_date).toBeNull();
    expect(row.status).toBe("deal_announced");
  });

  it("derives target_description from the active deal onto the row", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "pending",
          target_name: "Live Co",
          target_description: "Live Co makes electric buses.",
          announced_date: "2022-06-01",
        }),
      ],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: {},
      filingDate: "2022-06-01",
    });
    expect(row.target_name).toBe("Live Co");
    expect(row.target_description).toBe("Live Co makes electric buses.");
  });

  it("a completed deal wins over a later pending one and sets completed_date + status", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          target_name: "Won Co",
          definitive_agreement_date: "2022-01-01",
          outcome_date: "2022-05-01",
        }),
        deal({
          deal_index: 1,
          outcome: "pending",
          target_name: "Later Co",
          announced_date: "2023-01-01",
        }),
      ],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: {},
      filingDate: "2022-05-01",
    });
    expect(row.target_name).toBe("Won Co");
    expect(row.completed_date).toBe("2022-05-01");
    expect(row.status).toBe("completed");
  });

  it("latest pending deal by announced_date is active", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "pending",
          target_name: "Older",
          announced_date: "2022-01-01",
        }),
        deal({
          deal_index: 1,
          outcome: "pending",
          target_name: "Newer",
          announced_date: "2022-09-01",
        }),
      ],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: {},
      filingDate: "2022-09-01",
    });
    expect(row.target_name).toBe("Newer");
  });

  it("liquidation with no completed deal sets failed_date and liquidated status", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [deal({ deal_index: 0, outcome: "terminated" })],
      events: [
        ev({ event_type: "ipo", event_date: "2021-01-15" }),
        ev({ event_type: "liquidation", event_date: "2023-01-01" }),
      ],
      patch: {},
      filingDate: "2023-01-01",
    });
    expect(row.failed_date).toBe("2023-01-01");
    expect(row.status).toBe("liquidated");
  });

  it("sums redemptions only from the deal column (events are not double-counted)", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          redemption_amount: 50_000_000,
          outcome_date: "2022-05-01",
        }),
      ],
      events: [
        ev({ event_type: "ipo", event_date: "2021-01-15" }),
        // A stray redemption-typed event must NOT add on top of the deal column
        // that deriveDeals already correlated the redemption onto.
        ev({ event_type: "redemption", event_date: "2022-01-01", amount: 10_000_000 }),
      ],
      patch: {},
      filingDate: "2022-05-01",
    });
    expect(row.total_redemption_amount).toBe(50_000_000);
  });

  it("stale patch (older filing_date) does not overwrite merged scalar fields", () => {
    const existing = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: { spac_name: "Real Name", spac_sic: 6770 },
      filingDate: "2021-01-15",
    });
    const replayed = buildSpacRow({
      existing,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: { spac_name: "WRONG OLD NAME" },
      filingDate: "2020-01-01", // older than existing.as_of
    });
    expect(replayed.spac_name).toBe("Real Name");
    expect(replayed.as_of).toBe("2021-01-15");
  });
});
