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
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../../storage/spac/SpacCandidateSchema";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { Form_8_K } from "./Form_8_K";
import { processForm8K } from "./Form_8_K.storage";
import { mapItemCodesToSpacEvents } from "./spac8kMilestones";

describe("mapItemCodesToSpacEvents", () => {
  it("maps the four milestone item codes to lifecycle events", () => {
    expect(mapItemCodesToSpacEvents(["1.01"], "2021-03-01")).toEqual([
      { event_type: "definitive_agreement", event_date: "2021-03-01" },
    ]);
    expect(mapItemCodesToSpacEvents(["1.02"], "2021-03-01")).toEqual([
      { event_type: "terminated", event_date: "2021-03-01" },
    ]);
    expect(mapItemCodesToSpacEvents(["2.01"], "2021-03-01")).toEqual([
      { event_type: "completed", event_date: "2021-03-01" },
    ]);
    expect(mapItemCodesToSpacEvents(["5.07"], "2021-03-01")).toEqual([
      { event_type: "vote", event_date: "2021-03-01" },
    ]);
  });

  it("ignores non-milestone item codes", () => {
    expect(mapItemCodesToSpacEvents(["2.02", "9.01", "7.01"], "2021-03-01")).toEqual([]);
  });

  it("maps only the milestone items from a mixed filing", () => {
    const events = mapItemCodesToSpacEvents(["1.01", "7.01", "8.01", "9.01"], "2021-03-01");
    expect(events).toEqual([{ event_type: "definitive_agreement", event_date: "2021-03-01" }]);
  });
});

describe("processForm8K SPAC milestone wiring", () => {
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
  }

  async function run8K(
    cik: number,
    accession_number: string,
    items: string,
    report_date: string
  ): Promise<void> {
    const form8K = await Form_8_K.parse("8-K", "<html/>");
    await processForm8K({
      cik,
      accession_number,
      filing_date: report_date,
      form: "8-K",
      items,
      report_date,
      form8K,
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

  it("stays silent about a missing SPAC row for an issuer the screen never flagged", async () => {
    // 1.01 / 2.01 / 5.07 are ordinary 8-K items every operating company files,
    // so warning on the item codes alone fired on most 8-Ks in a corpus sweep.
    // A warning that common is unreadable at volume, which costs exactly the
    // cases it exists to surface.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await run8K(700, "700-da", "1.01", "2021-03-01");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about a missing SPAC row when the submissions screen flagged the issuer", async () => {
    // `spac_candidate` is independent, document-free evidence that this CIK
    // looks like a SPAC, so a dropped milestone here is worth an operator's
    // attention.
    await seedSpacCandidate(701);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await run8K(701, "701-da", "1.01", "2021-03-01");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("has no SPAC row");
    } finally {
      warn.mockRestore();
    }
  });

  it("advances a known SPAC through DA -> vote -> completion", async () => {
    await seedSpac(100);
    await run8K(100, "100-da", "1.01,9.01", "2021-03-01");
    await run8K(100, "100-vote", "5.07", "2021-06-01");
    await run8K(100, "100-close", "2.01,5.01", "2021-06-15");

    const row = await repo.getSpac(100);
    expect(row?.status).toBe("completed");
    expect(row?.definitive_agreement_date).toBe("2021-03-01");
    expect(row?.vote_date).toBe("2021-06-01");
    expect(row?.completed_date).toBe("2021-06-15");

    const deals = await repo.getDeals(100);
    expect(deals.length).toBe(1);
    expect(deals[0].outcome).toBe("completed");
  });

  it("links post-merger identity from entity metadata on the item 2.01 close", async () => {
    await seedSpac(150);
    // Post-close submissions have renamed the surviving operating company.
    await new EntityRepo().saveEntity({
      cik: 150,
      name: "Combined Operating Co, Inc.",
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
    await new EntityRepo().saveEntityTicker({ cik: 150, ticker: "COCO", exchange: "NASDAQ" });

    await run8K(150, "150-close", "2.01", "2021-06-15");

    const row = await repo.getSpac(150);
    expect(row?.status).toBe("completed");
    expect(row?.surviving_name).toBe("Combined Operating Co, Inc.");
    expect(row?.current_name).toBe("Combined Operating Co, Inc.");
    expect(row?.post_merger_sic).toBe(3711);
    expect(JSON.parse(row!.post_merger_tickers!)).toEqual(["COCO"]);
    expect(row?.spac_name).toBe("Test SPAC"); // shell name preserved
  });

  it("writes no SPAC events for a CIK with no spac row", async () => {
    await run8K(200, "200-da", "1.01,9.01", "2021-03-01");
    expect(await repo.getSpac(200)).toBeUndefined();
    expect(await repo.getEvents(200)).toEqual([]);
    expect(await repo.getDeals(200)).toEqual([]);
  });

  it("uses report_date as the event date and is idempotent on reprocess", async () => {
    await seedSpac(300);
    await run8K(300, "300-da", "1.01", "2021-03-01");
    await run8K(300, "300-da", "1.01", "2021-03-01"); // reprocess

    const events = await repo.getEvents(300);
    expect(events.filter((e) => e.event_type === "definitive_agreement").length).toBe(1);
    expect(events.find((e) => e.event_type === "definitive_agreement")?.event_date).toBe(
      "2021-03-01"
    );
    const deals = await repo.getDeals(300);
    expect(deals.length).toBe(1);
  });

  it("prefers report_date over filing_date for the event date", async () => {
    await seedSpac(400);
    const form8K = await Form_8_K.parse("8-K", "<html/>");
    await processForm8K({
      cik: 400,
      accession_number: "400-da",
      filing_date: "2021-03-10", // later than the report/triggering date
      form: "8-K",
      items: "1.01",
      report_date: "2021-03-01", // the actual triggering-event date
      form8K,
    });

    const events = await repo.getEvents(400);
    const da = events.find((e) => e.event_type === "definitive_agreement");
    expect(da?.event_date).toBe("2021-03-01");
    const deals = await repo.getDeals(400);
    expect(deals[0].definitive_agreement_date).toBe("2021-03-01");
  });

  it("records no milestone when neither report_date nor filing_date is available", async () => {
    await seedSpac(500);
    const form8K = await Form_8_K.parse("8-K", "<html/>");
    await processForm8K({
      cik: 500,
      accession_number: "500-da",
      filing_date: "", // best-effort path: filing-metadata row absent
      form: "8-K",
      items: "1.01",
      report_date: null,
      form8K,
    });

    // An undated 8-K must not write a milestone (empty event_date would be junk).
    const events = await repo.getEvents(500);
    expect(events.some((e) => e.event_type === "definitive_agreement")).toBe(false);
    expect(await repo.getDeals(500)).toEqual([]);
  });
});
