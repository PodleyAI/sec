/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { EntityRepo } from "../../../storage/entity/EntityRepo";
import { FILING_REPOSITORY_TOKEN } from "../../../storage/filing/FilingSchema";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../../storage/spac/SpacCandidateSchema";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { processDeregistration } from "./processDeregistration";

describe("processDeregistration", () => {
  let repo: SpacRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
  });

  async function seedSpac(cik: number): Promise<void> {
    await new SpacReportWriter().recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Test SPAC",
      spac_sic: 6770,
    });
    await new SpacReportWriter().recordIpo({
      cik,
      accession_number: `${cik}-ipo`,
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["FOO.U"],
    });
  }

  async function seedProxy(cik: number, date: string): Promise<void> {
    await new SpacReportWriter().recordDealMilestones({
      cik,
      accession_number: `${cik}-proxy`,
      filing_date: date,
      form: "DEFM14A",
      primary_document: null,
      events: [{ event_type: "proxy", event_date: date }],
    });
  }

  async function seedSpacCandidate(cik: number): Promise<void> {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put({
      cik,
      name: "Screened Acquisition Corp",
      current_sic: 6770,
      signal_sic_6770: true,
      signal_name_match: true,
      signal_renamed_from: null,
      signal_filed_sic_6770: true,
      first_reg_form: "S-1",
      first_reg_date: "2020-11-01",
      reg_while_spac_named: true,
      confidence: "high",
      identified_at: "2026-01-01T00:00:00.000Z",
    });
  }

  it("does nothing when the issuer has no SPAC row", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await processDeregistration({
        cik: 1822912,
        accession_number: "0001354457-23-000698",
        form: "25-NSE",
        filing_date: "2023-09-25",
      });
      expect(await repo.getEvents(1822912)).toEqual([]);
      expect(await repo.getSpac(1822912)).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when the submissions screen flagged the issuer but no SPAC row exists", async () => {
    await seedSpacCandidate(1822912);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await processDeregistration({
        cik: 1822912,
        accession_number: "0001354457-23-000698",
        form: "25-NSE",
        filing_date: "2023-09-25",
      });
      expect(await repo.getEvents(1822912)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("has no SPAC row");
    } finally {
      warn.mockRestore();
    }
  });

  it("records a second 25-NSE still inside the IPO window as unit_split, not liquidation", async () => {
    // Westin: two Nasdaq 25-NSEs a week apart, both within 180 days of IPO.
    await seedSpac(2076192);
    await processDeregistration({
      cik: 2076192,
      accession_number: "0001354457-25-001301",
      form: "25-NSE",
      filing_date: "2021-03-01",
    });
    await processDeregistration({
      cik: 2076192,
      accession_number: "0001354457-26-000012",
      form: "25-NSE",
      filing_date: "2021-03-08",
    });

    const events = await repo.getEvents(2076192);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(events.filter((e) => e.event_type === "unit_split")).toHaveLength(2);

    const row = await repo.getSpac(2076192);
    expect(row?.status).toBe("searching");
    expect(row?.unit_split_date).toBe("2021-03-01");
    expect(row?.failed_date).toBeNull();
  });

  it("does not liquidate a SPAC whose ipo_date is unknown", async () => {
    // The AI-content-classifier shape: `recordIpo` is gated on a 424B1/424B4
    // whose SGML header codes SIC 6770, so a SIC-miscoded SPAC minted from its
    // S-1 has a registration and no ipo_date at all. Its routine unit
    // separation must not read as a wind-up.
    await new SpacReportWriter().recordRegistration({
      cik: 2100001,
      accession_number: "2100001-reg",
      filing_date: "2026-01-05",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Miscoded Acquisition Corp",
      spac_sic: 7389,
    });
    expect((await repo.getSpac(2100001))?.ipo_date).toBeNull();

    await processDeregistration({
      cik: 2100001,
      accession_number: "2100001-nse",
      form: "25-NSE",
      filing_date: "2026-06-09",
    });

    const events = await repo.getEvents(2100001);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    const split = events.filter((e) => e.event_type === "unit_split");
    expect(split).toHaveLength(1);
    expect(split[0]?.accession_number).toBe("2100001-nse");

    const row = await repo.getSpac(2100001);
    expect(row?.status).not.toBe("liquidated");
    expect(row?.failed_date).toBeNull();
    expect(row?.unit_split_date).toBe("2026-06-09");
  });

  it("still liquidates on an issuer Form 25 when ipo_date is unknown", async () => {
    // The allowance is exchange-only — a real wind-up files one of these.
    await new SpacReportWriter().recordRegistration({
      cik: 2100002,
      accession_number: "2100002-reg",
      filing_date: "2026-01-05",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Miscoded Acquisition Corp II",
      spac_sic: 7389,
    });

    await processDeregistration({
      cik: 2100002,
      accession_number: "2100002-25",
      form: "25",
      filing_date: "2026-06-09",
    });

    const row = await repo.getSpac(2100002);
    expect(row?.status).toBe("liquidated");
    expect(row?.failed_date).toBe("2026-06-09");
  });

  it("records a unit_split for a 25-NSE shortly after IPO and does not liquidate", async () => {
    await seedSpac(1822912);
    await processDeregistration({
      cik: 1822912,
      accession_number: "0001354457-21-000100",
      form: "25-NSE",
      filing_date: "2021-03-01",
    });

    const events = await repo.getEvents(1822912);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    const split = events.filter((e) => e.event_type === "unit_split");
    expect(split).toHaveLength(1);
    expect(split[0]?.form).toBe("25-NSE");
    expect(split[0]?.event_date).toBe("2021-03-01");

    const row = await repo.getSpac(1822912);
    expect(row?.status).toBe("searching");
    expect(row?.unit_split_date).toBe("2021-03-01");
    expect(row?.failed_date).toBeNull();
  });

  it("replaces a previously recorded deregistration on the same 25-NSE accession", async () => {
    await seedSpac(1822912);
    await new SpacReportWriter().recordDeregistration({
      cik: 1822912,
      accession_number: "0001354457-21-000100",
      form: "25-NSE",
      filing_date: "2021-03-01",
    });
    expect((await repo.getSpac(1822912))?.status).toBe("liquidated");

    await processDeregistration({
      cik: 1822912,
      accession_number: "0001354457-21-000100",
      form: "25-NSE",
      filing_date: "2021-03-01",
    });

    const events = await repo.getEvents(1822912);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(events.filter((e) => e.event_type === "unit_split")).toHaveLength(1);
    expect((await repo.getSpac(1822912))?.status).toBe("searching");
  });

  it("does not close a pending deal when the 25-NSE is unit separation", async () => {
    await seedSpac(1822912);
    await new SpacReportWriter().recordDealMilestones({
      cik: 1822912,
      accession_number: "1822912-da",
      filing_date: "2021-02-01",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2021-02-01" }],
    });

    await processDeregistration({
      cik: 1822912,
      accession_number: "0001354457-21-000100",
      form: "25-NSE",
      filing_date: "2021-03-01",
    });

    const row = await repo.getSpac(1822912);
    expect(row?.status).toBe("deal_announced");
    expect(row?.definitive_agreement_date).toBe("2021-02-01");
    expect(row?.unit_split_date).toBe("2021-03-01");
    const deals = await repo.getDeals(1822912);
    expect(deals).toHaveLength(1);
    expect(deals[0]?.outcome).toBe("pending");
  });

  it("records a deregistration event and liquidates a known SPAC", async () => {
    await seedSpac(1822912);
    await processDeregistration({
      cik: 1822912,
      accession_number: "0001354457-23-000698",
      form: "25-NSE",
      filing_date: "2023-09-25",
    });

    const events = await repo.getEvents(1822912);
    const dereg = events.filter((e) => e.event_type === "deregistration");
    expect(dereg).toHaveLength(1);
    expect(dereg[0]?.form).toBe("25-NSE");
    expect(dereg[0]?.event_date).toBe("2023-09-25");

    const row = await repo.getSpac(1822912);
    expect(row?.status).toBe("liquidated");
    expect(row?.failed_date).toBe("2023-09-25");
  });

  it("closes a leftover pending DA so the spac row no longer shows an agreement", async () => {
    await seedSpac(1822912);
    await new SpacReportWriter().recordDealMilestones({
      cik: 1822912,
      accession_number: "1822912-da",
      filing_date: "2021-06-08",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2021-06-08" }],
    });
    expect((await repo.getSpac(1822912))?.definitive_agreement_date).toBe("2021-06-08");

    await processDeregistration({
      cik: 1822912,
      accession_number: "0001354457-23-000698",
      form: "25-NSE",
      filing_date: "2023-09-25",
    });

    const row = await repo.getSpac(1822912);
    expect(row?.status).toBe("liquidated");
    expect(row?.definitive_agreement_date).toBeNull();
    expect(row?.target_name).toBeNull();
    const deals = await repo.getDeals(1822912);
    expect(deals).toHaveLength(1);
    expect(deals[0]?.outcome).toBe("terminated");
    expect(deals[0]?.outcome_date).toBe("2023-09-25");
  });

  it("keeps completed status when a de-SPAC already closed", async () => {
    await seedSpac(50);
    await new SpacReportWriter().recordDealMilestones({
      cik: 50,
      accession_number: "50-close",
      filing_date: "2022-06-16",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "completed", event_date: "2022-06-15" }],
    });

    await processDeregistration({
      cik: 50,
      accession_number: "50-25",
      form: "25",
      filing_date: "2022-07-01",
    });

    const events = await repo.getEvents(50);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(
      events
        .filter((e) => e.event_type === "completed")
        .map((e) => e.form)
        .toSorted()
    ).toEqual(["25", "8-K"]);
    const row = await repo.getSpac(50);
    expect(row?.status).toBe("completed");
    expect(row?.failed_date).toBeNull();
  });

  it("is idempotent when the same filing is reprocessed", async () => {
    await seedSpac(51);
    const call = {
      cik: 51,
      accession_number: "51-nse",
      form: "25-NSE",
      filing_date: "2023-09-25",
    };
    await processDeregistration(call);
    await processDeregistration(call);

    const events = await repo.getEvents(51);
    expect(events.filter((e) => e.event_type === "deregistration")).toHaveLength(1);
  });

  it("takes failed_date from the earlier of Form 25 and Form 15", async () => {
    await seedSpac(52);
    await processDeregistration({
      cik: 52,
      accession_number: "52-nse",
      form: "25-NSE",
      filing_date: "2023-09-25",
    });
    await processDeregistration({
      cik: 52,
      accession_number: "52-15",
      form: "15-12G",
      filing_date: "2023-10-13",
    });

    const row = await repo.getSpac(52);
    expect(row?.failed_date).toBe("2023-09-25");
    const events = await repo.getEvents(52);
    expect(events.filter((e) => e.event_type === "deregistration")).toHaveLength(2);
  });

  it("skips an undated filing rather than writing a junk event_date", async () => {
    await seedSpac(53);
    await processDeregistration({
      cik: 53,
      accession_number: "53-nse",
      form: "25-NSE",
      filing_date: "",
    });
    expect(
      await repo.getEvents(53).then((e) => e.filter((x) => x.event_type === "deregistration"))
    ).toEqual([]);
  });

  it("records Form 15 after a vote as completed, not liquidation (Columbus Circle)", async () => {
    await seedSpac(2056263);
    await new SpacReportWriter().recordDealMilestones({
      cik: 2056263,
      accession_number: "2056263-da",
      filing_date: "2025-06-23",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2025-06-23" }],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 2056263,
      accession_number: "2056263-vote",
      filing_date: "2025-12-03",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2025-12-03" }],
    });
    await seedProxy(2056263, "2025-11-12");

    await processDeregistration({
      cik: 2056263,
      accession_number: "2056263-15",
      form: "15-12G",
      filing_date: "2025-12-22",
    });

    const events = await repo.getEvents(2056263);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(events.filter((e) => e.event_type === "completed").map((e) => e.form)).toEqual([
      "15-12G",
    ]);
    const row = await repo.getSpac(2056263);
    expect(row?.status).toBe("completed");
    expect(row?.failed_date).toBeNull();
    const deals = await repo.getDeals(2056263);
    expect(deals).toHaveLength(1);
    expect(deals[0]?.outcome).toBe("completed");
    expect(deals[0]?.outcome_date).toBe("2025-12-22");
  });

  it("records a 25-NSE after an extension vote with no merger proxy as liquidation (Zalatoris II)", async () => {
    await seedSpac(1853397);
    await new SpacReportWriter().recordDealMilestones({
      cik: 1853397,
      accession_number: "1853397-da",
      filing_date: "2023-12-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2023-12-05" }],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 1853397,
      accession_number: "1853397-vote",
      filing_date: "2024-08-02",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2024-08-02" }],
    });

    await processDeregistration({
      cik: 1853397,
      accession_number: "0001354457-24-000783",
      form: "25-NSE",
      filing_date: "2024-10-15",
    });

    const events = await repo.getEvents(1853397);
    expect(events.filter((e) => e.event_type === "completed")).toEqual([]);
    expect(events.some((e) => e.event_type === "deregistration")).toBe(true);
    const row = await repo.getSpac(1853397);
    expect(row?.status).toBe("liquidated");
    expect(row?.surviving_name).toBeNull();
  });

  it("records Form 15 after an earlier completed 25-NSE as housekeeping, not liquidation", async () => {
    await seedSpac(2032379);
    await new SpacReportWriter().recordDealMilestones({
      cik: 2032379,
      accession_number: "2032379-da",
      filing_date: "2025-09-15",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2025-09-15" }],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 2032379,
      accession_number: "2032379-vote",
      filing_date: "2026-04-30",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2026-04-30" }],
    });
    await seedProxy(2032379, "2026-04-15");
    await processDeregistration({
      cik: 2032379,
      accession_number: "2032379-nse",
      form: "25-NSE",
      filing_date: "2026-05-08",
    });
    expect((await repo.getSpac(2032379))?.status).toBe("completed");

    await processDeregistration({
      cik: 2032379,
      accession_number: "2032379-15",
      form: "15-12G",
      filing_date: "2026-06-09",
    });

    const events = await repo.getEvents(2032379);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(
      events
        .filter((e) => e.event_type === "completed")
        .map((e) => e.form)
        .sort()
    ).toEqual(["15-12G", "25-NSE"]);
    expect((await repo.getSpac(2032379))?.status).toBe("completed");
    expect((await repo.getSpac(2032379))?.failed_date).toBeNull();
  });

  it("replays a previously recorded deregistration as completed once a vote exists", async () => {
    await seedSpac(2054174);
    await new SpacReportWriter().recordDeregistration({
      cik: 2054174,
      accession_number: "2054174-nse",
      form: "25-NSE",
      filing_date: "2026-03-26",
    });
    expect((await repo.getSpac(2054174))?.status).toBe("liquidated");

    await new SpacReportWriter().recordDealMilestones({
      cik: 2054174,
      accession_number: "2054174-da",
      filing_date: "2025-10-01",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2025-10-01" }],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 2054174,
      accession_number: "2054174-vote",
      filing_date: "2026-03-20",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2026-03-20" }],
    });
    await seedProxy(2054174, "2026-03-01");

    await processDeregistration({
      cik: 2054174,
      accession_number: "2054174-nse",
      form: "25-NSE",
      filing_date: "2026-03-26",
    });

    const events = await repo.getEvents(2054174);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(
      events.some((e) => e.event_type === "completed" && e.accession_number === "2054174-nse")
    ).toBe(true);
    expect((await repo.getSpac(2054174))?.status).toBe("completed");
  });

  it("records a 25-NSE with a nearby 20-F as FPI close (Spring Valley III)", async () => {
    await seedSpac(2074850);
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
      cik: 2074850,
      accession_number: "2074850-20f",
      form: "20-F",
      primary_doc: "20f.htm",
      file_number: "",
      filing_date: "2026-07-16",
      acceptance_date: "2026-07-16T00:00:00.000Z",
      report_date: "2026-07-10",
      film_number: null,
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    } as never);

    await processDeregistration({
      cik: 2074850,
      accession_number: "2074850-nse",
      form: "25-NSE",
      filing_date: "2026-07-10",
    });

    const events = await repo.getEvents(2074850);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(events.filter((e) => e.event_type === "completed")).toHaveLength(1);
    expect((await repo.getSpac(2074850))?.status).toBe("completed");
  });

  it("does not complete a 25-NSE after a vote on a terminated deal (Evergreen)", async () => {
    await seedSpac(1900402);
    await new SpacReportWriter().recordDealMilestones({
      cik: 1900402,
      accession_number: "1900402-da",
      filing_date: "2024-09-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2024-09-05" }],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 1900402,
      accession_number: "1900402-vote",
      filing_date: "2025-01-28",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2025-01-28" }],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 1900402,
      accession_number: "1900402-term",
      filing_date: "2025-06-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "terminated", event_date: "2025-06-05" }],
    });

    await processDeregistration({
      cik: 1900402,
      accession_number: "1900402-nse",
      form: "25-NSE",
      filing_date: "2025-06-20",
    });

    const events = await repo.getEvents(1900402);
    expect(events.filter((e) => e.event_type === "completed")).toEqual([]);
    expect(events.some((e) => e.event_type === "deregistration")).toBe(true);
    expect((await repo.getSpac(1900402))?.status).toBe("liquidated");
  });

  it("replays a previously recorded completed 25-NSE as deregistration once the deal terminated", async () => {
    // The 25-NSE sits 41 days after the vote — deliberately INSIDE
    // LISTING_REMOVAL_MAX_DAYS_AFTER_APPROVAL, because this test is about the
    // replay reclassification, not about the window. The interposed
    // `terminated` still precedes the 25-NSE, which is what makes phase two
    // re-derive it as a wind-up.
    await seedSpac(1900402);
    await new SpacReportWriter().recordDealMilestones({
      cik: 1900402,
      accession_number: "1900402-da",
      filing_date: "2024-09-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2024-09-05" }],
    });
    await new SpacReportWriter().recordDealMilestones({
      cik: 1900402,
      accession_number: "1900402-vote",
      filing_date: "2025-01-28",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2025-01-28" }],
    });
    await seedProxy(1900402, "2025-01-10");
    await processDeregistration({
      cik: 1900402,
      accession_number: "1900402-nse",
      form: "25-NSE",
      filing_date: "2025-03-10",
    });
    expect((await repo.getSpac(1900402))?.status).toBe("completed");

    await new SpacReportWriter().recordDealMilestones({
      cik: 1900402,
      accession_number: "1900402-term",
      filing_date: "2025-03-01",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "terminated", event_date: "2025-03-01" }],
    });
    await processDeregistration({
      cik: 1900402,
      accession_number: "1900402-nse",
      form: "25-NSE",
      filing_date: "2025-03-10",
    });

    const events = await repo.getEvents(1900402);
    expect(events.filter((e) => e.event_type === "completed")).toEqual([]);
    expect(
      events.some((e) => e.event_type === "deregistration" && e.accession_number === "1900402-nse")
    ).toBe(true);
    expect((await repo.getSpac(1900402))?.status).toBe("liquidated");
  });

  it("liquidates a SPAC whose post-vote deal died in an 8.01 with no 1.02", async () => {
    // The shape the approval window exists for. The deal reached a definitive
    // agreement, a proxy and a vote, then collapsed — disclosed under Item
    // 8.01, which `mapItemCodesToSpacEvents` maps to no event at all, so no
    // `terminated` was ever written and the attempt stays `pending` with its
    // vote_date. Eighteen months later the vehicle winds up.
    //
    // The entity row is seeded FIRST, renamed and re-SIC'd, precisely so this
    // test would fail loudly if `recordDeSpacLinkage` ran: the promoted
    // identity would land on a shell that never merged.
    const cik = 1900500;
    await seedSpac(cik);
    await new EntityRepo().saveEntity({
      cik,
      name: "Operating Newco, Inc.",
      type: null,
      sic: 3711,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: null,
      state_incorporation_desc: null,
    });
    await new EntityRepo().saveEntityTicker({ cik, ticker: "NEWCO", exchange: "NASDAQ" });

    const writer = new SpacReportWriter();
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-da`,
      filing_date: "2023-01-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2023-01-05" }],
    });
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-proxy`,
      filing_date: "2023-01-20",
      form: "DEFM14A",
      primary_document: null,
      events: [{ event_type: "proxy", event_date: "2023-01-20" }],
    });
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-vote`,
      filing_date: "2023-02-01",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2023-02-01" }],
    });

    await processDeregistration({
      cik,
      accession_number: `${cik}-nse`,
      form: "25-NSE",
      filing_date: "2024-08-01",
    });
    await processDeregistration({
      cik,
      accession_number: `${cik}-15`,
      form: "15-12B",
      filing_date: "2024-09-03",
    });

    const events = await repo.getEvents(cik);
    expect(events.filter((e) => e.event_type === "completed")).toEqual([]);
    expect(
      events
        .filter((e) => e.event_type === "deregistration")
        .map((e) => e.accession_number)
        .sort()
    ).toEqual([`${cik}-15`, `${cik}-nse`]);

    const row = await repo.getSpac(cik);
    expect(row?.status).toBe("liquidated");
    // Load-bearing: no completed deal means no post-merger identity at all.
    expect(row?.surviving_name).toBeNull();
    expect(row?.post_merger_sic).toBeNull();
    expect(row?.post_merger_tickers).toBeNull();
    expect(row?.current_name).toBe(row?.spac_name);
  });

  it("clears a promoted post-merger identity when a replay re-derives the vehicle as wound up", async () => {
    // Run the corrupted shape by hand — what the unbounded predicate produced —
    // then reprocess the same accession under the fixed classifier. The
    // corrected event stream must drop the promoted identity, not merge it
    // forward: post-merger columns are derived from a completed deal, and there
    // is no longer one.
    const cik = 1900501;
    await seedSpac(cik);
    await new EntityRepo().saveEntity({
      cik,
      name: "Operating Newco, Inc.",
      type: null,
      sic: 3711,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: null,
      state_incorporation_desc: null,
    });
    await new EntityRepo().saveEntityTicker({ cik, ticker: "NEWCO", exchange: "NASDAQ" });

    const writer = new SpacReportWriter();
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-da`,
      filing_date: "2023-01-05",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "definitive_agreement", event_date: "2023-01-05" }],
    });
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-vote`,
      filing_date: "2023-02-01",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "vote", event_date: "2023-02-01" }],
    });
    await writer.recordCompleted({
      cik,
      accession_number: `${cik}-nse`,
      form: "25-NSE",
      filing_date: "2024-08-01",
    });
    await writer.recordDeSpacLinkage({
      cik,
      accession_number: `${cik}-nse`,
      form: "25-NSE",
      filing_date: "2024-08-01",
    });
    const corrupted = await repo.getSpac(cik);
    expect(corrupted?.surviving_name).toBe("Operating Newco, Inc.");
    expect(corrupted?.surviving_name_source).toBe("entity");
    expect(corrupted?.current_name).toBe("Operating Newco, Inc.");

    await processDeregistration({
      cik,
      accession_number: `${cik}-nse`,
      form: "25-NSE",
      filing_date: "2024-08-01",
    });

    const row = await repo.getSpac(cik);
    expect(row?.status).toBe("liquidated");
    expect(row?.surviving_name).toBeNull();
    expect(row?.surviving_name_source).toBeNull();
    expect(row?.post_merger_sic).toBeNull();
    expect(row?.post_merger_tickers).toBeNull();
    expect(row?.current_name).toBe(row?.spac_name);
    expect(row?.current_sic).toBe(row?.spac_sic);
    expect(row?.current_tickers).toBe(row?.spac_tickers);
  });

  it("records the first 20-F after an F-4 as FPI close (NewGenIvf)", async () => {
    await seedSpac(1981662);
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
      cik: 1981662,
      accession_number: "1981662-f4",
      form: "F-4",
      primary_doc: "f4.htm",
      file_number: "",
      filing_date: "2023-10-27",
      acceptance_date: "2023-10-27T00:00:00.000Z",
      report_date: null,
      film_number: null,
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    } as never);
    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
      cik: 1981662,
      accession_number: "1981662-20f",
      form: "20-F",
      primary_doc: "20f.htm",
      file_number: "",
      filing_date: "2024-04-09",
      acceptance_date: "2024-04-09T00:00:00.000Z",
      report_date: "2024-04-02",
      film_number: null,
      primary_doc_description: null,
      size: null,
      is_xbrl: null,
      is_inline_xbrl: null,
      items: null,
      act: null,
    } as never);

    await processDeregistration({
      cik: 1981662,
      accession_number: "1981662-20f",
      form: "20-F",
      filing_date: "2024-04-09",
    });

    expect((await repo.getSpac(1981662))?.status).toBe("completed");
    const events = await repo.getEvents(1981662);
    expect(events.some((e) => e.event_type === "completed" && e.form === "20-F")).toBe(true);
  });

  it("ignores an annual 20-F once the close is already recorded", async () => {
    await seedSpac(2074852);
    await new SpacReportWriter().recordDealMilestones({
      cik: 2074852,
      accession_number: "2074852-close",
      filing_date: "2025-06-16",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "completed", event_date: "2025-06-15" }],
    });
    const before = await repo.getSpac(2074852);

    await processDeregistration({
      cik: 2074852,
      accession_number: "2074852-20f",
      form: "20-F",
      filing_date: "2026-03-31",
    });

    const events = await repo.getEvents(2074852);
    expect(events.filter((e) => e.event_type === "completed").map((e) => e.form)).toEqual(["8-K"]);
    const after = await repo.getSpac(2074852);
    expect(after?.as_of).toBe(before?.as_of);
    expect(after?.completed_date).toBe("2025-06-15");
  });

  it("does not liquidate an FPI SPAC on an annual 20-F with no close signal", async () => {
    await seedSpac(2074851);
    await processDeregistration({
      cik: 2074851,
      accession_number: "2074851-20f",
      form: "20-F",
      filing_date: "2026-03-31",
    });
    expect(
      await repo.getEvents(2074851).then((e) => e.filter((x) => x.event_type === "completed"))
    ).toEqual([]);
    expect(
      await repo.getEvents(2074851).then((e) => e.filter((x) => x.event_type === "deregistration"))
    ).toEqual([]);
    expect((await repo.getSpac(2074851))?.status).toBe("ipo");
  });
});
