/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../change-tracking/ChangeLogSchema";
import type { SpacHistory } from "./SpacHistorySchema";
import { SpacMergerExtractionRepo } from "./SpacMergerExtractionRepo";
import { SpacRepo } from "./SpacRepo";
import { SpacReportWriter } from "./SpacReportWriter";

describe("SpacReportWriter", () => {
  let repo: SpacRepo;
  let writer: SpacReportWriter;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
    writer = new SpacReportWriter();
  });

  it("records registration then ipo and rolls the row forward", async () => {
    await writer.recordRegistration({
      cik: 5,
      accession_number: "0000-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Foo SPAC",
      spac_sic: 6770,
    });
    let row = await repo.getSpac(5);
    expect(row?.status).toBe("registered");
    expect(row?.registration_date).toBe("2020-12-01");

    await writer.recordIpo({
      cik: 5,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["FOO.U", "FOO", "FOO.WS"],
    });
    row = await repo.getSpac(5);
    expect(row?.status).toBe("ipo");
    expect(row?.ipo_date).toBe("2021-01-15");
    expect(row?.ipo_proceeds).toBe(200_000_000);
    expect(JSON.parse(row!.spac_tickers!)).toEqual(["FOO.U", "FOO", "FOO.WS"]);
    expect(row?.spac_name).toBe("Foo SPAC"); // merged, not clobbered by the IPO filing
  });

  it("an out-of-order older registration replay does not regress the row", async () => {
    await writer.recordIpo({
      cik: 6,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["BAR.U"],
    });
    const before = await repo.getSpac(6);
    expect(before?.as_of).toBe("2021-01-15");

    await writer.recordRegistration({
      cik: 6,
      accession_number: "0000-reg",
      filing_date: "2020-12-01", // older
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Bar SPAC",
      spac_sic: 6770,
    });
    const after = await repo.getSpac(6);
    expect(after?.as_of).toBe("2021-01-15"); // anchor not regressed
    expect(after?.registration_date).toBe("2020-12-01"); // but the event date still rolls in
    expect(after?.ipo_proceeds).toBe(200_000_000); // IPO scalars preserved
    expect(after?.spac_name).toBe("Bar SPAC"); // name was null, fills from the older filing
  });

  it("writes history snapshots and ChangeLog rows on change", async () => {
    await writer.recordRegistration({
      cik: 7,
      accession_number: "0000-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Baz SPAC",
      spac_sic: 6770,
    });
    const history = await repo.getHistory(7);
    expect(history.length).toBe(1);
    expect(history[0].valid_to).toBeNull();
    const changeLog = globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN);
    const changes = (await changeLog.query({ entity_type: "spac", entity_id: "7" })) || [];
    expect(changes.length).toBeGreaterThan(0);
  });

  it("keeps a coherent history chain when two writes land in the same millisecond", async () => {
    // Freeze the no-arg clock so registration and ipo get an identical
    // updated_at, forcing a (cik, valid_from) collision in the history table.
    // Explicit-arg `new Date(ms)` (used to bump the colliding timestamp) stays real.
    const RealDate = Date;
    const FIXED = RealDate.parse("2026-06-01T00:00:00.000Z");
    class FakeDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof Date> | []) {
        if (args.length === 0) super(FIXED);
        else super(...(args as ConstructorParameters<typeof Date>));
      }
      static now(): number {
        return FIXED;
      }
    }
    globalThis.Date = FakeDate as DateConstructor;
    try {
      await writer.recordRegistration({
        cik: 8,
        accession_number: "0000-reg",
        filing_date: "2020-12-01",
        form: "S-1",
        primary_document: "s1.htm",
        spac_name: "Same MS SPAC",
        spac_sic: 6770,
      });
      await writer.recordIpo({
        cik: 8,
        accession_number: "0000-ipo",
        filing_date: "2021-01-15",
        form: "424B4",
        primary_document: "424.htm",
        ipo_proceeds: 100_000_000,
        trust_amount: 100_000_000,
        spac_tickers: ["SMS.U"],
      });
    } finally {
      globalThis.Date = RealDate;
    }

    const history = await repo.getHistory(8);
    // Both changes are retained (no silent overwrite), and exactly one row is open.
    expect(history.length).toBe(2);
    expect(history.filter((h) => h.valid_to == null).length).toBe(1);
    const closed = history.find((h) => h.valid_to != null);
    const openRow = history.find((h) => h.valid_to == null);
    expect(closed).toBeDefined();
    // The closed row hands off to the open row at the same instant (contiguous).
    expect(closed!.valid_to).toBe(openRow!.valid_from);
    expect(closed!.valid_from < openRow!.valid_from).toBe(true);
  });

  it("does not erase existing tickers when a later filing carries none", async () => {
    await writer.recordIpo({
      cik: 9,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["NEO.U", "NEO"],
    });
    // A same-or-newer reprocess that found no tickers must NOT clobber them.
    await writer.recordIpo({
      cik: 9,
      accession_number: "0000-ipo",
      filing_date: "2021-02-01",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: null,
    });
    const row = await repo.getSpac(9);
    expect(JSON.parse(row!.spac_tickers!)).toEqual(["NEO.U", "NEO"]);
  });

  it("rolls a registered SPAC forward through DA, vote, and completion", async () => {
    await writer.recordRegistration({
      cik: 10,
      accession_number: "0000-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Merge SPAC",
      spac_sic: 6770,
    });

    await writer.recordDealMilestones({
      cik: 10,
      accession_number: "0000-da",
      filing_date: "2021-03-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2021-03-01" }],
    });
    let row = await repo.getSpac(10);
    expect(row?.status).toBe("deal_announced");
    expect(row?.definitive_agreement_date).toBe("2021-03-01");

    await writer.recordDealMilestones({
      cik: 10,
      accession_number: "0000-vote",
      filing_date: "2021-06-02",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2021-06-01" }],
    });
    row = await repo.getSpac(10);
    expect(row?.status).toBe("proxy");
    expect(row?.vote_date).toBe("2021-06-01");

    await writer.recordDealMilestones({
      cik: 10,
      accession_number: "0000-close",
      filing_date: "2021-06-16",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "completed", event_date: "2021-06-15" }],
    });
    row = await repo.getSpac(10);
    expect(row?.status).toBe("completed");
    expect(row?.completed_date).toBe("2021-06-15");

    const deals = await repo.getDeals(10);
    expect(deals.length).toBe(1);
    expect(deals[0].outcome).toBe("completed");
    expect(deals[0].target_name).toBeNull(); // not available from item codes
  });

  it("is idempotent when the same milestone 8-K is reprocessed", async () => {
    const call = {
      cik: 11,
      accession_number: "0000-da",
      filing_date: "2021-03-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement" as const, event_date: "2021-03-01" }],
    };
    await writer.recordDealMilestones(call);
    await writer.recordDealMilestones(call);

    const events = await repo.getEvents(11);
    expect(events.filter((e) => e.event_type === "definitive_agreement").length).toBe(1);
    const deals = await repo.getDeals(11);
    expect(deals.length).toBe(1);
  });

  it("replaces a prior item-mapped type on the same accession and stores detail", async () => {
    await writer.recordRegistration({
      cik: 13,
      accession_number: "0000-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Reclass SPAC",
      spac_sic: 6770,
    });
    await writer.recordDealMilestones({
      cik: 13,
      accession_number: "0000-101",
      filing_date: "2021-01-14",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2021-01-14" }],
    });
    await writer.recordDealMilestones({
      cik: 13,
      accession_number: "0000-101",
      filing_date: "2021-01-14",
      form: "8-K",
      primary_document: null,
      events: [
        {
          event_type: "material_agreement",
          event_date: "2021-01-14",
          detail: "EX-1.1 UNDERWRITING AGREEMENT\tex11.htm",
        },
      ],
    });

    const events = await repo.getEvents(13);
    expect(events.filter((e) => e.event_type === "definitive_agreement")).toEqual([]);
    const misc = events.find((e) => e.event_type === "material_agreement");
    expect(misc?.detail).toBe("EX-1.1 UNDERWRITING AGREEMENT\tex11.htm");
    expect(await repo.getDeals(13)).toEqual([]);
  });

  it("does nothing when given no events", async () => {
    await writer.recordDealMilestones({
      cik: 12,
      accession_number: "0000-none",
      filing_date: "2021-03-05",
      form: "8-K",
      primary_document: null,
      events: [],
    });
    expect(await repo.getSpac(12)).toBeUndefined();
    expect(await repo.getEvents(12)).toEqual([]);
  });

  it("derives target/pipe + proxy from a recorded merger proxy and rolls up", async () => {
    await writer.recordRegistration({
      cik: 20,
      accession_number: "20-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Merge SPAC",
      spac_sic: 6770,
    });
    await writer.recordDealMilestones({
      cik: 20,
      accession_number: "20-da",
      filing_date: "2021-03-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2021-03-01" }],
    });

    await new SpacMergerExtractionRepo().save({
      accession_number: "20-defm",
      cik: 20,
      form: "DEFM14A",
      filing_date: "2021-05-01",
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      target_name: "Acme Target Inc.",
      target_cik: 999,
      target_observation_id: 1,
      pipe_amount: 150_000_000,
      merger_consideration: "$10.00 per share in stock",
      target_description: null,
      confidence: 0.95,
      source_span: "merger with Acme Target Inc.",
      seeks_combination_approval: null,
      model_id: "claude-sonnet-5",
      created_at: new Date().toISOString(),
    });
    await writer.recordMergerProxy({
      cik: 20,
      accession_number: "20-defm",
      filing_date: "2021-05-01",
      form: "DEFM14A",
      primary_document: "defm.htm",
      emitProxyEvent: true,
    });

    const row = await repo.getSpac(20);
    expect(row?.status).toBe("proxy");
    expect(row?.target_name).toBe("Acme Target Inc.");
    expect(row?.pipe_amount).toBe(150_000_000);
    expect(row?.proxy_date).toBe("2021-05-01");

    const deals = await repo.getDeals(20);
    expect(deals[0].target_name).toBe("Acme Target Inc.");
    expect(deals[0].target_cik).toBe(999);
  });

  it("does not emit a proxy event for a preliminary proxy (PREM14A)", async () => {
    await writer.recordRegistration({
      cik: 21,
      accession_number: "21-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Merge SPAC",
      spac_sic: 6770,
    });
    await writer.recordDealMilestones({
      cik: 21,
      accession_number: "21-da",
      filing_date: "2021-03-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2021-03-01" }],
    });
    await new SpacMergerExtractionRepo().save({
      accession_number: "21-prem",
      cik: 21,
      form: "PREM14A",
      filing_date: "2021-04-01",
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      target_name: "Acme Target Inc.",
      target_cik: null,
      target_observation_id: null,
      pipe_amount: null,
      merger_consideration: null,
      target_description: null,
      confidence: 0.9,
      source_span: null,
      seeks_combination_approval: null,
      model_id: null,
      created_at: new Date().toISOString(),
    });
    await writer.recordMergerProxy({
      cik: 21,
      accession_number: "21-prem",
      filing_date: "2021-04-01",
      form: "PREM14A",
      primary_document: "prem.htm",
      emitProxyEvent: false,
    });

    const events = await repo.getEvents(21);
    expect(events.some((e) => e.event_type === "proxy")).toBe(false);
    const row = await repo.getSpac(21);
    expect(row?.target_name).toBe("Acme Target Inc."); // still correlated
    expect(row?.status).toBe("deal_announced"); // no proxy event -> not "proxy"
  });

  it("serialises concurrent same-CIK writes (no interleaved read-derive-write)", async () => {
    // Two filings for the same SPAC processed concurrently (as the form tasks
    // do with concurrencyLimit > 1). Each record* method is an unsynchronised
    // read-derive-write over the CIK's rows; if two overlap they lost-update the
    // derived row / fork the history chain. The repo here makes its writes
    // observably slow and tracks how many record* critical sections are in
    // flight at once: the per-CIK lock must keep that at 1.
    let inFlight = 0;
    let maxInFlight = 0;
    class InstrumentedSpacRepo extends SpacRepo {
      async saveHistory(history: SpacHistory): Promise<void> {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return await super.saveHistory(history);
        } finally {
          inFlight -= 1;
        }
      }
    }
    const slowRepo = new InstrumentedSpacRepo();
    // Distinct writer instances sharing the storage — the lock map is
    // module-scoped, so it must serialise across instances, not just within one.
    const w1 = new SpacReportWriter(slowRepo);
    const w2 = new SpacReportWriter(slowRepo);

    await Promise.all([
      w1.recordRegistration({
        cik: 99,
        accession_number: "99-reg",
        filing_date: "2020-12-01",
        form: "S-1",
        primary_document: "s1.htm",
        spac_name: "Race SPAC",
        spac_sic: 6770,
      }),
      w2.recordIpo({
        cik: 99,
        accession_number: "99-ipo",
        filing_date: "2021-01-15",
        form: "424B4",
        primary_document: "424.htm",
        ipo_proceeds: 150_000_000,
        trust_amount: 150_000_000,
        spac_tickers: ["RACE.U"],
      }),
    ]);

    // The two critical sections never overlapped.
    expect(maxInFlight).toBe(1);
    // Exactly one open history row, and the derived row reflects both events.
    const history = await repo.getHistory(99);
    expect(history.filter((h) => h.valid_to == null).length).toBe(1);
    const events = await repo.getEvents(99);
    expect(events.some((e) => e.event_type === "registration")).toBe(true);
    expect(events.some((e) => e.event_type === "ipo")).toBe(true);
    const row = await repo.getSpac(99);
    expect(row?.registration_date).toBe("2020-12-01");
    expect(row?.ipo_date).toBe("2021-01-15");
    expect(row?.ipo_proceeds).toBe(150_000_000);
  });

  it("valid_from is strictly increasing across writes even when the wall clock rewinds", async () => {
    // First write at "now"; second write with the wall clock rewound 90 days.
    // A snapshot derived from `new Date()` would emit a valid_from earlier than
    // the previously-closed row's valid_to and invert the chain.
    const RealDate = Date;
    const setNow = (ms: number): void => {
      class FakeDate extends RealDate {
        constructor(...args: ConstructorParameters<typeof Date> | []) {
          if (args.length === 0) super(ms);
          else super(...(args as ConstructorParameters<typeof Date>));
        }
        static now(): number {
          return ms;
        }
      }
      globalThis.Date = FakeDate as DateConstructor;
    };
    const T_LATE = RealDate.parse("2026-06-01T00:00:00.000Z");
    const T_REWOUND = RealDate.parse("2026-03-01T00:00:00.000Z"); // 90 days earlier
    try {
      setNow(T_LATE);
      await writer.recordRegistration({
        cik: 30,
        accession_number: "30-reg",
        filing_date: "2021-01-10", // forward
        form: "S-1",
        primary_document: "s1.htm",
        spac_name: "Clock Rewind SPAC",
        spac_sic: 6770,
      });
      setNow(T_REWOUND);
      await writer.recordIpo({
        cik: 30,
        accession_number: "30-ipo",
        filing_date: "2021-02-15", // forward
        form: "424B4",
        primary_document: "424.htm",
        ipo_proceeds: 100_000_000,
        trust_amount: 100_000_000,
        spac_tickers: ["CRW.U"],
      });
    } finally {
      globalThis.Date = RealDate;
    }

    const history = await repo.getHistory(30);
    expect(history.length).toBe(2);
    const sorted = [...history].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    expect(sorted[0].valid_from < sorted[1].valid_from).toBe(true);
    expect(sorted[0].valid_to).toBe(sorted[1].valid_from); // contiguous
    expect(history.filter((h) => h.valid_to == null).length).toBe(1);
  });

  it("stale-replay history is anchored at existing as_of, not wall clock", async () => {
    // Seed at "2021-06-01"; then replay a stale write with filing_date older
    // than the as_of guard. The history row must not be stamped at current
    // wall clock — that lets stale data sneak into the most recent slot.
    await writer.recordIpo({
      cik: 31,
      accession_number: "31-ipo",
      filing_date: "2021-06-01",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["STALE.U"],
    });
    const after = await repo.getSpac(31);
    expect(after?.as_of).toBe("2021-06-01");

    // Stale replay: older filing_date than as_of.
    await writer.recordRegistration({
      cik: 31,
      accession_number: "31-reg",
      filing_date: "2020-12-01", // older
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Stale Replay SPAC",
      spac_sic: 6770,
    });

    const history = await repo.getHistory(31);
    // Find the newest history row (the stale-replay snapshot).
    const sorted = [...history].sort((a, b) => b.valid_from.localeCompare(a.valid_from));
    const newest = sorted[0];
    // Anchor must be the existing as_of (2021-06-01), not current wall clock.
    // We assert it's NOT the current year — a wall-clock anchor would be 2026+.
    expect(newest.valid_from.startsWith("2021-06")).toBe(true);
  });

  it("the closed-row chain is never overlapped across many writes", async () => {
    // Three writes; assert valid_to of each closed row matches valid_from of
    // the next row, and the chain is strictly increasing.
    await writer.recordRegistration({
      cik: 32,
      accession_number: "32-reg",
      filing_date: "2021-01-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Chain SPAC",
      spac_sic: 6770,
    });
    await writer.recordIpo({
      cik: 32,
      accession_number: "32-ipo",
      filing_date: "2021-02-01",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 50_000_000,
      trust_amount: 50_000_000,
      spac_tickers: ["CHN.U"],
    });
    await writer.recordDealMilestones({
      cik: 32,
      accession_number: "32-da",
      filing_date: "2021-03-01",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2021-03-01" }],
    });

    const history = await repo.getHistory(32);
    const sorted = [...history].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
    for (let i = 0; i + 1 < sorted.length; i++) {
      expect(sorted[i].valid_to).toBe(sorted[i + 1].valid_from);
      expect(sorted[i].valid_from < sorted[i + 1].valid_from).toBe(true);
    }
    expect(sorted[sorted.length - 1].valid_to).toBeNull();
  });

  it("closes EVERY open history row, healing a table that already has more than one", async () => {
    // The invariant is one open row per CIK, but nothing enforced it: the
    // snapshot used `history.find(h => h.valid_to == null)`, which closes only
    // the earliest and leaves any others open forever. A live table reached
    // this state (two open rows, overlapping intervals) after the Postgres
    // date-string regression truncated the millisecond chain the ordering math
    // runs on. The next write must repair it rather than perpetuate it.
    await writer.recordRegistration({
      cik: 77,
      accession_number: "0000-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Healed SPAC",
      spac_sic: 6770,
    });

    // Forge the corruption directly: a second open row alongside the real one.
    const [existing] = await repo.getHistory(77);
    await repo.saveHistory({
      ...(existing as SpacHistory),
      valid_from: "2020-12-01T00:00:00.500Z",
      valid_to: null,
    });
    expect((await repo.getHistory(77)).filter((h) => h.valid_to == null).length).toBe(2);

    await writer.recordIpo({
      cik: 77,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["HEAL.U"],
    });

    const history = await repo.getHistory(77);
    expect(history.filter((h) => h.valid_to == null).length).toBe(1);
    // The surviving open row is the newest, and every closed row hands off to it.
    const open = history.find((h) => h.valid_to == null)!;
    for (const closed of history.filter((h) => h.valid_to != null)) {
      expect(closed.valid_from < open.valid_from).toBe(true);
    }
  });

  it("records current trust from company facts without moving as_of or IPO trust", async () => {
    await writer.recordIpo({
      cik: 80,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["TRU.U"],
    });
    const applied = await writer.recordCurrentTrust({
      cik: 80,
      amount: 204_000_000,
      asOf: "2024-06-30",
      filed: "2024-08-14",
    });
    expect(applied).toBe(true);
    const row = await repo.getSpac(80);
    expect(row?.trust_amount).toBe(200_000_000);
    expect(row?.current_trust_amount).toBe(204_000_000);
    expect(row?.current_trust_as_of).toBe("2024-06-30");
    expect(row?.current_trust_filed).toBe("2024-08-14");
    expect(row?.as_of).toBe("2021-01-15");
  });

  it("does not mint a spac row from a trust snapshot and rejects an older quarter", async () => {
    expect(
      await writer.recordCurrentTrust({
        cik: 81,
        amount: 1,
        asOf: "2024-03-31",
        filed: "2024-05-15",
      })
    ).toBe(false);
    expect(await repo.getSpac(81)).toBeUndefined();

    await writer.recordIpo({
      cik: 82,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["OLD.U"],
    });
    await writer.recordCurrentTrust({
      cik: 82,
      amount: 104_000_000,
      asOf: "2024-06-30",
      filed: "2024-08-14",
    });
    expect(
      await writer.recordCurrentTrust({
        cik: 82,
        amount: 101_000_000,
        asOf: "2024-03-31",
        filed: "2024-05-15",
      })
    ).toBe(false);
    expect((await repo.getSpac(82))?.current_trust_amount).toBe(104_000_000);
  });
});
