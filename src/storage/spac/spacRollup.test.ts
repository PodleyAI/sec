/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { SpacDeal } from "./SpacDealSchema";
import type { SpacEvent } from "./SpacEventSchema";
import { deriveDeals } from "./spacDealGrouping";
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
    loi_date: null,
    announced_date: null,
    definitive_agreement_date: null,
    proxy_date: null,
    vote_date: null,
    pipe_amount: null,
    equity_value: null,
    enterprise_value: null,
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

  it("drops an entity-sourced surviving name when no deal is completed", () => {
    // Post-merger identity is DERIVED from a completed combination, not merged
    // forward. A misclassified filing can promote a surviving name onto a shell
    // that never merged; when the corrected event stream re-derives the vehicle
    // as wound up, the promotion has to go with it — otherwise the row keeps
    // reading as the operating company forever.
    const promoted = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [deal({ deal_index: 0, outcome: "completed", outcome_date: "2024-08-01" })],
      events: [ev({ event_type: "completed", event_date: "2024-08-01" })],
      patch: {
        spac_name: "Shell SPAC",
        surviving_name: "Operating Newco, Inc.",
        post_merger_sic: 3711,
        post_merger_tickers: '["NEWCO"]',
      },
      filingDate: "2024-08-01",
    });
    expect(promoted.surviving_name_source).toBe("entity");

    const rebuilt = buildSpacRow({
      existing: promoted,
      cik: 1,
      deals: [deal({ deal_index: 0, outcome: "terminated", outcome_date: "2024-08-01" })],
      events: [
        ev({ event_type: "vote", event_date: "2023-02-01" }),
        ev({ event_type: "deregistration", event_date: "2024-08-01" }),
      ],
      patch: {},
      filingDate: "2024-08-02",
    });
    expect(rebuilt.surviving_name).toBeNull();
    expect(rebuilt.surviving_name_source).toBeNull();
    expect(rebuilt.post_merger_sic).toBeNull();
    expect(rebuilt.post_merger_tickers).toBeNull();
    // Every current_* chain collapses back to the spac_* mirror.
    expect(rebuilt.current_name).toBe("Shell SPAC");
    expect(rebuilt.current_sic).toBe(rebuilt.spac_sic);
    expect(rebuilt.current_tickers).toBe(rebuilt.spac_tickers);
  });

  it("keeps an entity-sourced surviving name while a deal is completed", () => {
    // The other half of the gate: a rebuild that still derives a completed deal
    // must not disturb the close-time entity snapshot.
    const promoted = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [deal({ deal_index: 0, outcome: "completed", outcome_date: "2024-08-01" })],
      events: [ev({ event_type: "completed", event_date: "2024-08-01" })],
      patch: {
        spac_name: "Shell SPAC",
        surviving_name: "Operating Newco, Inc.",
        post_merger_sic: 3711,
        post_merger_tickers: '["NEWCO"]',
      },
      filingDate: "2024-08-01",
    });

    const rebuilt = buildSpacRow({
      existing: promoted,
      cik: 1,
      deals: [deal({ deal_index: 0, outcome: "completed", outcome_date: "2024-08-01" })],
      events: [ev({ event_type: "completed", event_date: "2024-08-01" })],
      patch: {},
      filingDate: "2024-08-02",
    });
    expect(rebuilt.surviving_name).toBe("Operating Newco, Inc.");
    expect(rebuilt.surviving_name_source).toBe("entity");
    expect(rebuilt.post_merger_sic).toBe(3711);
    expect(rebuilt.post_merger_tickers).toBe('["NEWCO"]');
    expect(rebuilt.current_name).toBe("Operating Newco, Inc.");
    expect(rebuilt.current_sic).toBe(3711);
  });

  it("lifts current_name from a name_change event when the deal is not completed", () => {
    const events = [
      ev({ event_type: "ipo", event_date: "2021-08-10" }),
      ev({
        event_type: "name_change",
        event_date: "2023-07-27",
        detail: "# Zalatoris II Acquisition Corp",
      }),
      ev({ event_type: "deregistration", event_date: "2024-10-15" }),
    ];
    const first = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events,
      patch: { spac_name: "XPAC Acquisition Corp." },
      filingDate: "2023-07-27",
    });
    expect(first.current_name).toBe("Zalatoris II Acquisition Corp");

    const rebuilt = buildSpacRow({
      existing: first,
      cik: 1,
      deals: [],
      events,
      patch: {},
      filingDate: "2024-10-15",
    });
    expect(rebuilt.current_name).toBe("Zalatoris II Acquisition Corp");
    expect(rebuilt.spac_name).toBe("XPAC Acquisition Corp.");
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

  it("merges current trust from a patch and does not clobber it on a later filing without it", () => {
    const existing = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: { trust_amount: 200_000_000 },
      filingDate: "2021-01-15",
    });
    const withTrust = buildSpacRow({
      existing,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: {
        current_trust_amount: 204_000_000,
        current_trust_as_of: "2024-06-30",
        current_trust_filed: "2024-08-14",
      },
      filingDate: "2021-01-15",
    });
    expect(withTrust.trust_amount).toBe(200_000_000);
    expect(withTrust.current_trust_amount).toBe(204_000_000);
    expect(withTrust.current_trust_as_of).toBe("2024-06-30");
    expect(withTrust.current_trust_filed).toBe("2024-08-14");
    expect(withTrust.as_of).toBe("2021-01-15");

    const laterIpo = buildSpacRow({
      existing: withTrust,
      cik: 1,
      deals: [],
      events: [ev({ event_type: "ipo", event_date: "2021-01-15" })],
      patch: { ipo_proceeds: 200_000_000 },
      filingDate: "2021-02-01",
    });
    expect(laterIpo.current_trust_amount).toBe(204_000_000);
    expect(laterIpo.current_trust_as_of).toBe("2024-06-30");
    expect(laterIpo.trust_amount).toBe(200_000_000);
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

  it("a post-close Form 25 leaves status completed with a null failed_date", () => {
    // The delisting of a de-SPAC'd shell's units is routine housekeeping, not a
    // failure of the vehicle.
    const events = [
      ev({ event_type: "ipo", event_date: "2021-01-15" }),
      ev({ event_type: "definitive_agreement", event_date: "2022-01-10" }),
      ev({ event_type: "deregistration", event_date: "2022-06-16" }),
      ev({ event_type: "completed", event_date: "2022-06-21" }),
    ];
    // Derived, not hand-written: the rollup only reads `deals.some(completed)`,
    // so the failure this guards is upstream in the event walk.
    const deals = deriveDeals(1, events, [], [], []).map((d) => ({
      ...d,
      target_name: "Acme Robotics, Inc.",
    }));
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals,
      events,
      patch: {},
      filingDate: "2022-06-21",
    });
    expect(row.status).toBe("completed");
    expect(row.failed_date).toBeNull();
    expect(row.completed_date).toBe("2022-06-21");
    expect(row.surviving_name).toBe("Acme Robotics, Inc.");
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

  it("a unit_split with no ipo event fills unit_split_date and leaves status registered", () => {
    // The rollup half of the unknown-IPO-floor rule: a SIC-miscoded SPAC has a
    // registration and no `ipo` event, so `deriveStatus` never reaches the
    // unit_split branch (it is inside `hasIpo`). The date is recorded and no
    // IPO is claimed that no filing supports.
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "registration", event_date: "2026-01-05" }),
        ev({ event_type: "unit_split", event_date: "2026-06-09" }),
      ],
      patch: {},
      filingDate: "2026-06-09",
    });
    expect(row.status).toBe("registered");
    expect(row.unit_split_date).toBe("2026-06-09");
    expect(row.ipo_date).toBeNull();
    expect(row.failed_date).toBeNull();
  });

  it("registration plus a withdrawal event is withdrawn, not leftover registered", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "registration", event_date: "2021-02-16" }),
        ev({ event_type: "withdrawal", event_date: "2022-01-04" }),
      ],
      patch: {},
      filingDate: "2022-01-04",
    });
    expect(row.status).toBe("withdrawn");
  });

  it("a registration dated after the last withdrawal reopens as registered", () => {
    // Innovative Digital / FPA Energy: Form RW then a later S-1 family.
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "registration", event_date: "2024-05-30" }),
        ev({ event_type: "withdrawal", event_date: "2024-11-21" }),
        ev({ event_type: "registration", event_date: "2025-05-30" }),
      ],
      patch: {},
      filingDate: "2025-05-30",
    });
    expect(row.status).toBe("registered");
    expect(row.registration_date).toBe("2024-05-30");
  });

  it("a second RW after the reopened S-1 is withdrawn again", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "registration", event_date: "2024-05-30" }),
        ev({ event_type: "withdrawal", event_date: "2024-11-21" }),
        ev({ event_type: "registration", event_date: "2025-05-30" }),
        ev({ event_type: "withdrawal", event_date: "2025-08-01" }),
      ],
      patch: {},
      filingDate: "2025-08-01",
    });
    expect(row.status).toBe("withdrawn");
  });

  it("an IPO then a withdrawal stays ipo — RW after pricing is not a never-priced shell", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "registration", event_date: "2021-01-01" }),
        ev({ event_type: "ipo", event_date: "2021-06-01" }),
        ev({ event_type: "withdrawal", event_date: "2022-01-04" }),
      ],
      patch: {},
      filingDate: "2022-01-04",
    });
    expect(row.status).toBe("ipo");
  });

  it("completed still wins over a withdrawal event", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [
        deal({
          deal_index: 0,
          outcome: "completed",
          target_name: "Acme Robotics, Inc.",
          outcome_date: "2022-06-21",
        }),
      ],
      events: [
        ev({ event_type: "ipo", event_date: "2021-01-15" }),
        ev({ event_type: "completed", event_date: "2022-06-21" }),
        ev({ event_type: "withdrawal", event_date: "2022-07-01" }),
      ],
      patch: {},
      filingDate: "2022-07-01",
    });
    expect(row.status).toBe("completed");
  });

  it("liquidation still wins over a withdrawal event", () => {
    const row = buildSpacRow({
      existing: undefined,
      cik: 1,
      deals: [],
      events: [
        ev({ event_type: "ipo", event_date: "2021-01-15" }),
        ev({ event_type: "withdrawal", event_date: "2022-01-04" }),
        ev({ event_type: "deregistration", event_date: "2023-09-25" }),
      ],
      patch: {},
      filingDate: "2023-09-25",
    });
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
