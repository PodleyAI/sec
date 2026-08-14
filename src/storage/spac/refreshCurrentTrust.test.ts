/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../facts/CompanyFactsSchema";
import type { CompanyFact } from "../facts/CompanyFactsSchema";
import { SpacRepo } from "./SpacRepo";
import { SpacReportWriter } from "./SpacReportWriter";
import { refreshCurrentTrustFromFacts } from "./refreshCurrentTrust";

function fact(over: Partial<CompanyFact> = {}): CompanyFact {
  return {
    cik: 90,
    grouping: "us-gaap",
    name: "AssetsHeldInTrust",
    filed_date: "2024-08-14",
    form: "10-Q",
    val_unit: "USD",
    frame: "CY2024Q2",
    accession_number: "0001-24-002",
    start_date: null,
    end_date: "2024-06-30",
    val: 204_000_000,
    fy: 2024,
    fp: "Q2",
    ...over,
  };
}

describe("refreshCurrentTrustFromFacts", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("no-ops when the CIK is not a known SPAC", async () => {
    const facts = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
    await facts.put(fact());
    expect(await refreshCurrentTrustFromFacts(90)).toBe(false);
    expect(await new SpacRepo().getSpac(90)).toBeUndefined();
  });

  it("lifts the latest 10-Q trust fact onto a known SPAC", async () => {
    await new SpacReportWriter().recordIpo({
      cik: 90,
      accession_number: "0000-ipo",
      filing_date: "2021-01-15",
      form: "424B4",
      primary_document: "424.htm",
      ipo_proceeds: 200_000_000,
      trust_amount: 200_000_000,
      spac_tickers: ["TRU.U"],
    });
    const facts = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
    await facts.put(fact({ val: 201_000_000, end_date: "2024-03-31", filed_date: "2024-05-15" }));
    await facts.put(fact());
    expect(await refreshCurrentTrustFromFacts(90)).toBe(true);
    const row = await new SpacRepo().getSpac(90);
    expect(row?.current_trust_amount).toBe(204_000_000);
    expect(row?.current_trust_as_of).toBe("2024-06-30");
    expect(row?.trust_amount).toBe(200_000_000);
    expect(await refreshCurrentTrustFromFacts(90)).toBe(false);
  });
});
