/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import type { SpacDeal } from "../../storage/spac/SpacDealSchema";
import type { SpacEvent } from "../../storage/spac/SpacEventSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { resetSpacProcessState } from "./resetSpacProcessState";

const CIK = 1800001;
const OTHER = 1800002;

function event(
  partial: Partial<SpacEvent> &
    Pick<SpacEvent, "cik" | "accession_number" | "event_type" | "event_date">
): SpacEvent {
  return {
    form: null,
    primary_document: null,
    source_document_url: null,
    deal_index: null,
    amount: null,
    shares: null,
    detail: null,
    confidence: null,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

function deal(cik: number, deal_index: number): SpacDeal {
  return {
    cik,
    deal_index,
    target_name: "Acme",
    target_cik: null,
    target_description: null,
    announced_date: "2022-01-01",
    definitive_agreement_date: null,
    proxy_date: null,
    vote_date: null,
    loi_date: null,
    pipe_amount: null,
    redemption_amount: 1,
    redemption_shares: 1,
    outcome: "pending",
    outcome_date: null,
    source_accession: "deal",
    created_at: "2022-01-01T00:00:00.000Z",
  };
}

async function seedRun(
  cik: number,
  accession: string,
  extractor_id: string,
  extractor_version = "1.0.0"
): Promise<void> {
  const repo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  await repo.recordRun({
    cik,
    accession_number: accession,
    form: extractor_id,
    extractor_id,
    extractor_version,
    slot_at_run: "current",
    success: true,
    error: null,
  });
}

/** The active-version map a `spac process --force` over these forms would build. */
function versions(...extractorIds: readonly string[]): ReadonlyMap<string, string> {
  return new Map(extractorIds.map((id) => [id, "1.0.0"]));
}

describe("resetSpacProcessState", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("clears events, deals, extractor runs, and filing-sourced spac fields for this CIK", async () => {
    const repo = new SpacRepo();
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik: CIK,
      accession_number: "reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Wipe SPAC",
      spac_sic: 6770,
    });
    await writer.recordIpo({
      cik: CIK,
      accession_number: "ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["WIP.U"],
    });
    await writer.recordEditorial({
      cik: CIK,
      url_spac: "https://spac.example.com",
      url_sponsor: "https://sponsor.example.com",
      details: JSON.stringify({ unit_price: 10 }),
    });
    await writer.recordCurrentTrust({
      cik: CIK,
      amount: 201_000_000,
      asOf: "2021-06-30",
      filed: "2021-08-15",
    });
    await repo.saveDeal(deal(CIK, 0));
    await seedRun(CIK, "reg", "S-1");
    await seedRun(CIK, "8k", "redemption");
    // Off the replayed timeline, and an older generation of one that is on it:
    // both are audit trail the coverage gate counts and nothing can rebuild.
    await seedRun(CIK, "form-d", "D");
    await seedRun(CIK, "old-reg", "S-1", "0.9.0");

    const historyBefore = await repo.getHistory(CIK);
    expect(historyBefore.length).toBeGreaterThan(0);

    await resetSpacProcessState(CIK, versions("S-1", "redemption"));

    expect(await repo.getEvents(CIK)).toEqual([]);
    expect(await repo.getDeals(CIK)).toEqual([]);
    const runs = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    expect(await runs.findRun(CIK, "reg", "S-1", "1.0.0")).toBeUndefined();
    expect(await runs.findRun(CIK, "8k", "redemption", "1.0.0")).toBeUndefined();
    expect((await runs.findRun(CIK, "form-d", "D", "1.0.0"))?.success).toBe(true);
    expect((await runs.findRun(CIK, "old-reg", "S-1", "0.9.0"))?.success).toBe(true);

    const row = await repo.getSpac(CIK);
    expect(row).toBeDefined();
    expect(row?.status).toBe("registered");
    expect(row?.as_of).toBeNull();
    expect(row?.spac_name).toBeNull();
    expect(row?.ipo_proceeds).toBeNull();
    expect(row?.trust_amount).toBeNull();
    expect(row?.ipo_date).toBeNull();
    expect(row?.registration_date).toBeNull();
    expect(row?.spac_tickers).toBeNull();
    expect(row?.url_spac).toBe("https://spac.example.com");
    expect(row?.url_sponsor).toBe("https://sponsor.example.com");
    expect(row?.details).toBe(JSON.stringify({ unit_price: 10 }));
    expect(row?.current_trust_amount).toBe(201_000_000);
    expect(row?.current_trust_as_of).toBe("2021-06-30");
    expect(row?.current_trust_filed).toBe("2021-08-15");
    expect(await repo.getHistory(CIK)).toEqual(historyBefore);
  });

  it("does not mint a spac row when none exists", async () => {
    const repo = new SpacRepo();
    await repo.saveEvent(
      event({ cik: CIK, accession_number: "ipo", event_type: "ipo", event_date: "2021-01-15" })
    );
    await repo.saveDeal(deal(CIK, 0));
    await seedRun(CIK, "ipo", "424");

    await resetSpacProcessState(CIK, versions("424"));

    expect(await repo.getSpac(CIK)).toBeUndefined();
    expect(await repo.getEvents(CIK)).toEqual([]);
    expect(await repo.getDeals(CIK)).toEqual([]);
  });

  it("does not wipe another CIK's events, deals, or runs", async () => {
    const repo = new SpacRepo();
    const writer = new SpacReportWriter();
    await writer.recordRegistration({
      cik: OTHER,
      accession_number: "other-reg",
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Other SPAC",
      spac_sic: 6770,
    });
    await seedRun(OTHER, "other-reg", "S-1");
    await resetSpacProcessState(CIK, versions("S-1"));

    expect((await repo.getEvents(OTHER)).length).toBe(1);
    expect((await repo.getSpac(OTHER))?.spac_name).toBe("Other SPAC");
    const runs = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const otherRun = await runs.findRun(OTHER, "other-reg", "S-1", "1.0.0");
    expect(otherRun?.success).toBe(true);
  });
});
