/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import type { CompanyFact } from "../../storage/facts/CompanyFactsSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";
import { BackfillTrustTask } from "./BackfillTrustTask";

function fact(cik: number, over: Partial<CompanyFact> = {}): CompanyFact {
  return {
    cik,
    grouping: "us-gaap",
    name: "AssetsHeldInTrust",
    filed_date: "2024-08-14",
    form: "10-Q",
    val_unit: "USD",
    frame: "CY2024Q2",
    accession_number: `${cik}-24-002`,
    start_date: null,
    end_date: "2024-06-30",
    val: 204_000_000,
    fy: 2024,
    fp: "Q2",
    ...over,
  };
}

describe("BackfillTrustTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("updates known SPACs that have a later trust fact and reports dry-run without writing", async () => {
    const writer = new SpacReportWriter();
    await writer.recordIpo({
      cik: 91,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["A.U"],
    });
    await writer.recordIpo({
      cik: 92,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 100_000_000,
      trust_amount: 100_000_000,
      spac_tickers: ["B.U"],
    });
    const facts = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
    await facts.put(fact(91));

    const dry = await new BackfillTrustTask().execute({ dryRun: true });
    expect(dry).toEqual({ selected: 2, updated: 1 });
    expect((await new SpacRepo().getSpac(91))?.current_trust_amount ?? null).toBeNull();

    const live = await new BackfillTrustTask().execute({ dryRun: false });
    expect(live).toEqual({ selected: 2, updated: 1 });
    expect((await new SpacRepo().getSpac(91))?.current_trust_amount).toBe(204_000_000);
    expect((await new SpacRepo().getSpac(92))?.current_trust_amount ?? null).toBeNull();
  });
});
