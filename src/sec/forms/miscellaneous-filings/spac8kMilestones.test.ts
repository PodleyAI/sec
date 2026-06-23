/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { mapItemCodesToSpacEvents } from "./spac8kMilestones";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { Form_8_K } from "./Form_8_K";
import { processForm8K } from "./Form_8_K.storage";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";

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
    expect(events).toEqual([
      { event_type: "definitive_agreement", event_date: "2021-03-01" },
    ]);
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
    expect(
      events.find((e) => e.event_type === "definitive_agreement")?.event_date
    ).toBe("2021-03-01");
    const deals = await repo.getDeals(300);
    expect(deals.length).toBe(1);
  });
});
