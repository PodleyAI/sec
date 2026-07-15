/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { EntityRepo } from "../entity/EntityRepo";
import { SpacRepo } from "./SpacRepo";
import { SpacReportWriter } from "./SpacReportWriter";

describe("SpacReportWriter.recordDeSpacLinkage", () => {
  let repo: SpacRepo;
  let writer: SpacReportWriter;
  let entities: EntityRepo;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
    writer = new SpacReportWriter();
    entities = new EntityRepo();
  });

  async function registerAndComplete(cik: number): Promise<void> {
    await writer.recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Shell Acquisition Corp",
      spac_sic: 6770,
    });
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-close`,
      filing_date: "2021-06-16",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "completed", event_date: "2021-06-15" }],
    });
  }

  it("links post-merger name / SIC / tickers from the CIK's own entity metadata", async () => {
    const cik = 700;
    await registerAndComplete(cik);
    // Post-close submissions have refreshed the entity to the renamed operating company.
    await entities.saveEntity({
      cik,
      name: "NewCo Industries, Inc.",
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
    await entities.saveEntityTicker({ cik, ticker: "NEWCO", exchange: "NASDAQ" });

    await writer.recordDeSpacLinkage({
      cik,
      accession_number: `${cik}-close`,
      filing_date: "2021-06-16",
      form: "8-K",
    });

    const row = await repo.getSpac(cik);
    expect(row?.status).toBe("completed");
    expect(row?.surviving_name).toBe("NewCo Industries, Inc.");
    expect(row?.current_name).toBe("NewCo Industries, Inc.");
    expect(row?.post_merger_sic).toBe(3711);
    expect(row?.current_sic).toBe(3711);
    expect(JSON.parse(row!.post_merger_tickers!)).toEqual(["NEWCO"]);
    expect(JSON.parse(row!.current_tickers!)).toEqual(["NEWCO"]);
    // The shell keeps its CIK in the common case, so current_cik stays null.
    expect(row?.current_cik).toBeNull();
    // SPAC-era columns are preserved.
    expect(row?.spac_name).toBe("Shell Acquisition Corp");
    expect(row?.spac_sic).toBe(6770);
  });

  it("is a write-once snapshot: a later rebrand does not mutate populated linkage", async () => {
    const cik = 703;
    await registerAndComplete(cik);
    await entities.saveEntity({
      cik,
      name: "NewCo Industries, Inc.",
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
    await entities.saveEntityTicker({ cik, ticker: "NEWCO", exchange: "NASDAQ" });
    await writer.recordDeSpacLinkage({
      cik,
      accession_number: `${cik}-close`,
      filing_date: "2021-06-16",
      form: "8-K",
    });

    // The issuer later rebrands (and re-tickers). A subsequent linkage refresh
    // must NOT overwrite the close-time snapshot.
    await entities.saveEntity({
      cik,
      name: "Rebranded Holdings, Inc.",
      type: null,
      sic: 3714,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: null,
      state_incorporation_desc: null,
    });
    await entities.saveEntityTicker({ cik, ticker: "RBHI", exchange: "NASDAQ" });
    await writer.recordDeSpacLinkage({
      cik,
      accession_number: `${cik}-refresh`,
      filing_date: "2022-01-01",
      form: "8-K",
    });

    const row = await repo.getSpac(cik);
    expect(row?.surviving_name).toBe("NewCo Industries, Inc.");
    expect(row?.post_merger_sic).toBe(3711);
    expect(JSON.parse(row!.post_merger_tickers!)).toEqual(["NEWCO"]);
  });

  it("does not populate post_merger_tickers when the symbols mirror the SPAC-era tickers", async () => {
    const cik = 704;
    await writer.recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Shell Acquisition Corp",
      spac_sic: 6770,
    });
    await writer.recordIpo({
      cik,
      accession_number: `${cik}-ipo`,
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["SHELL"],
    });
    await writer.recordDealMilestones({
      cik,
      accession_number: `${cik}-close`,
      filing_date: "2021-06-16",
      form: "8-K",
      primary_document: null,
      events: [{ event_type: "completed", event_date: "2021-06-15" }],
    });
    // Entity tickers still carry the SPAC-era symbol (submissions not yet updated).
    await entities.saveEntityTicker({ cik, ticker: "SHELL", exchange: "NASDAQ" });

    await writer.recordDeSpacLinkage({
      cik,
      accession_number: `${cik}-close`,
      filing_date: "2021-06-16",
      form: "8-K",
    });

    const row = await repo.getSpac(cik);
    // The SPAC-era symbol must not leak into the post-merger snapshot.
    expect(row?.post_merger_tickers).toBeNull();
  });

  it("no-ops when the SPAC has not completed a combination", async () => {
    const cik = 701;
    await writer.recordRegistration({
      cik,
      accession_number: `${cik}-reg`,
      filing_date: "2020-12-01",
      form: "S-1",
      primary_document: "s1.htm",
      spac_name: "Shell Acquisition Corp",
      spac_sic: 6770,
    });
    // Entity renamed but no completion event — linkage must not populate.
    await entities.saveEntity({
      cik,
      name: "Premature NewCo",
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

    await writer.recordDeSpacLinkage({
      cik,
      accession_number: `${cik}-x`,
      filing_date: "2021-01-01",
      form: "8-K",
    });

    const row = await repo.getSpac(cik);
    expect(row?.status).toBe("registered");
    expect(row?.surviving_name).toBeNull();
    expect(row?.post_merger_sic).toBeNull();
    expect(row?.post_merger_tickers).toBeNull();
  });

  it("no-ops (leaves post_merger_* null) when entity metadata has not caught up", async () => {
    const cik = 702;
    await registerAndComplete(cik);
    // No entity row saved (submissions not yet refreshed to the rename).
    await writer.recordDeSpacLinkage({
      cik,
      accession_number: `${cik}-close`,
      filing_date: "2021-06-16",
      form: "8-K",
    });
    const row = await repo.getSpac(cik);
    expect(row?.status).toBe("completed");
    expect(row?.post_merger_sic).toBeNull();
    expect(row?.post_merger_tickers).toBeNull();
  });
});
