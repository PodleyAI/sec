/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
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
    expect(await repo.getEvents(53).then((e) => e.filter((x) => x.event_type === "deregistration"))).toEqual(
      []
    );
  });
});
