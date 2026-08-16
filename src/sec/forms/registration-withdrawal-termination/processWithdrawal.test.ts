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
import { processWithdrawal } from "./processWithdrawal";

describe("processWithdrawal", () => {
  let repo: SpacRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
  });

  async function seedRegistered(cik: number): Promise<void> {
    await new SpacReportWriter().recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2021-02-16",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Test SPAC",
      spac_sic: 6770,
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
      signal_filed_sic_6770: null,
    });
  }

  it("does nothing when the issuer has no SPAC row", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await processWithdrawal({
        cik: 1848507,
        accession_number: "0001193125-22-001518",
        form: "RW",
        filing_date: "2022-01-04",
      });
      expect(await repo.getEvents(1848507)).toEqual([]);
      expect(await repo.getSpac(1848507)).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("warns when the submissions screen flagged the issuer but no SPAC row exists", async () => {
    await seedSpacCandidate(1848507);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await processWithdrawal({
        cik: 1848507,
        accession_number: "0001193125-22-001518",
        form: "RW",
        filing_date: "2022-01-04",
      });
      expect(await repo.getEvents(1848507)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("has no SPAC row");
    } finally {
      warn.mockRestore();
    }
  });

  it("records a withdrawal event and marks a registered SPAC withdrawn", async () => {
    await seedRegistered(1848507);
    await processWithdrawal({
      cik: 1848507,
      accession_number: "0001193125-22-001518",
      form: "RW",
      filing_date: "2022-01-04",
    });

    const events = await repo.getEvents(1848507);
    const withdrawn = events.filter((e) => e.event_type === "withdrawal");
    expect(withdrawn).toHaveLength(1);
    expect(withdrawn[0]?.form).toBe("RW");
    expect(withdrawn[0]?.event_date).toBe("2022-01-04");

    const row = await repo.getSpac(1848507);
    expect(row?.status).toBe("withdrawn");
  });

  it("does not un-IPO a vehicle that already priced", async () => {
    await seedRegistered(50);
    await new SpacReportWriter().recordIpo({
      cik: 50,
      accession_number: "50-ipo",
      filing_date: "2021-06-01",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["FOO.U"],
    });
    await processWithdrawal({
      cik: 50,
      accession_number: "50-rw",
      form: "RW",
      filing_date: "2022-01-04",
    });

    const events = await repo.getEvents(50);
    expect(events.some((e) => e.event_type === "withdrawal")).toBe(true);
    expect((await repo.getSpac(50))?.status).toBe("ipo");
  });

  it("skips RW WD rather than treating an undone withdrawal as a withdrawal", async () => {
    await seedRegistered(51);
    await processWithdrawal({
      cik: 51,
      accession_number: "51-wd",
      form: "RW WD",
      filing_date: "2022-01-05",
    });
    expect(
      await repo.getEvents(51).then((e) => e.filter((x) => x.event_type === "withdrawal"))
    ).toEqual([]);
    expect((await repo.getSpac(51))?.status).toBe("registered");
  });

  it("is idempotent when the same filing is reprocessed", async () => {
    await seedRegistered(52);
    const call = {
      cik: 52,
      accession_number: "52-rw",
      form: "RW",
      filing_date: "2022-01-04",
    };
    await processWithdrawal(call);
    await processWithdrawal(call);

    const events = await repo.getEvents(52);
    expect(events.filter((e) => e.event_type === "withdrawal")).toHaveLength(1);
  });

  it("skips an undated filing rather than writing a junk event_date", async () => {
    await seedRegistered(53);
    await processWithdrawal({
      cik: 53,
      accession_number: "53-rw",
      form: "RW",
      filing_date: "",
    });
    expect(
      await repo.getEvents(53).then((e) => e.filter((x) => x.event_type === "withdrawal"))
    ).toEqual([]);
  });
});
