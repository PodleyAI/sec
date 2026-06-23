/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SpacRepo } from "./SpacRepo";
import { SpacReportWriter } from "./SpacReportWriter";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../change-tracking/ChangeLogSchema";

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
});
