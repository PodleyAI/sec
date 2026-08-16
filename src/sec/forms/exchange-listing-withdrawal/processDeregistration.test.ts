/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
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

  async function seedSpacCandidate(cik: number): Promise<void> {
    await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put({
      cik,
      name: "Screened Acquisition Corp",
      current_sic: 6770,
      signal_sic_6770: true,
      signal_name_match: true,
      signal_renamed_from: null,
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
    expect(events.some((e) => e.event_type === "deregistration")).toBe(true);
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

    await processDeregistration({
      cik: 2056263,
      accession_number: "2056263-15",
      form: "15-12G",
      filing_date: "2025-12-22",
    });

    const events = await repo.getEvents(2056263);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(events.filter((e) => e.event_type === "completed").map((e) => e.form)).toEqual(["15-12G"]);
    const row = await repo.getSpac(2056263);
    expect(row?.status).toBe("completed");
    expect(row?.failed_date).toBeNull();
    const deals = await repo.getDeals(2056263);
    expect(deals).toHaveLength(1);
    expect(deals[0]?.outcome).toBe("completed");
    expect(deals[0]?.outcome_date).toBe("2025-12-22");
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

    await processDeregistration({
      cik: 2054174,
      accession_number: "2054174-nse",
      form: "25-NSE",
      filing_date: "2026-03-26",
    });

    const events = await repo.getEvents(2054174);
    expect(events.filter((e) => e.event_type === "deregistration")).toEqual([]);
    expect(events.some((e) => e.event_type === "completed" && e.accession_number === "2054174-nse")).toBe(
      true
    );
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
});
