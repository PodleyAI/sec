/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ALL_SECURITIES_OFFERED_TYPES } from "../../config/schemaRoundTripFixtures";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import type { RegAEquityClass } from "./RegAEquityClassSchema";
import type { RegAFinancialData } from "./RegAFinancialDataSchema";
import type { RegAOfferingHistory } from "./RegAOfferingHistorySchema";
import { RegAOfferingRepo } from "./RegAOfferingRepo";
import type { RegAOffering } from "./RegAOfferingSchema";
import type { RegAServiceProvider } from "./RegAServiceProviderSchema";

describe("RegAOfferingRepo", () => {
  let repo: RegAOfferingRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = new RegAOfferingRepo();
  });

  describe("Offering CRUD", () => {
    it("should save and retrieve an offering", async () => {
      const offering: RegAOffering = {
        cik: 12345,
        file_number: "024-00001",
        issuer_name: "Test Issuer Inc",
        jurisdiction: "DE",
        sic_code: 7372,
        tier: "Tier1",
        financial_statement_audit_status: "Audited",
        securities_offered_type: ["Equity (common or preferred stock)"],
        industry_group: "Other",
        status: "pending",
        as_of: null,
      };

      await repo.saveOffering(offering);
      const retrieved = await repo.getOffering(12345, "024-00001");

      expect(retrieved).toBeDefined();
      expect(retrieved?.issuer_name).toBe("Test Issuer Inc");
      expect(retrieved?.tier).toBe("Tier1");
      expect(retrieved?.status).toBe("pending");
    });

    it("should update an existing offering", async () => {
      const offering: RegAOffering = {
        cik: 12345,
        file_number: "024-00001",
        issuer_name: "Test Issuer Inc",
        jurisdiction: "DE",
        sic_code: 7372,
        tier: "Tier1",
        financial_statement_audit_status: "Audited",
        securities_offered_type: ["Equity (common or preferred stock)"],
        industry_group: "Other",
        status: "pending",
        as_of: null,
      };

      await repo.saveOffering(offering);
      await repo.saveOffering({ ...offering, status: "reporting" });

      const retrieved = await repo.getOffering(12345, "024-00001");
      expect(retrieved?.status).toBe("reporting");
    });

    it("should search offerings by CIK", async () => {
      await repo.saveOffering({
        cik: 12345,
        file_number: "024-00001",
        issuer_name: "Issuer A",
        jurisdiction: "DE",
        sic_code: null,
        tier: "Tier1",
        financial_statement_audit_status: null,
        securities_offered_type: null,
        industry_group: null,
        status: "pending",
        as_of: null,
      });
      await repo.saveOffering({
        cik: 12345,
        file_number: "024-00002",
        issuer_name: "Issuer B",
        jurisdiction: "CA",
        sic_code: null,
        tier: "Tier2",
        financial_statement_audit_status: null,
        securities_offered_type: null,
        industry_group: null,
        status: "reporting",
        as_of: null,
      });

      const results = await repo.getOfferingsByCik(12345);
      expect(results.length).toBe(2);
    });

    it("should search offerings by status", async () => {
      await repo.saveOffering({
        cik: 12345,
        file_number: "024-00001",
        issuer_name: "Pending Issuer",
        jurisdiction: null,
        sic_code: null,
        tier: null,
        financial_statement_audit_status: null,
        securities_offered_type: null,
        industry_group: null,
        status: "pending",
        as_of: null,
      });
      await repo.saveOffering({
        cik: 67890,
        file_number: "024-00002",
        issuer_name: "Exit Issuer",
        jurisdiction: null,
        sic_code: null,
        tier: null,
        financial_statement_audit_status: null,
        securities_offered_type: null,
        industry_group: null,
        status: "exit",
        as_of: null,
      });

      const pending = await repo.getOfferingsByStatus("pending");
      expect(pending.length).toBe(1);
      expect(pending[0].issuer_name).toBe("Pending Issuer");

      const exit = await repo.getOfferingsByStatus("exit");
      expect(exit.length).toBe(1);
      expect(exit[0].issuer_name).toBe("Exit Issuer");
    });
  });

  describe("saveOfferingAsOf", () => {
    const CIK = 55555;
    const FN = "024-09999";

    // 1-A: full row with tier; status carried forward from existing.
    const save1A = (filing_date: string) =>
      repo.saveOfferingAsOf(CIK, FN, filing_date, (existing) => ({
        cik: CIK,
        file_number: FN,
        issuer_name: "RegA Issuer Inc",
        jurisdiction: "DE",
        sic_code: 7372,
        tier: "Tier2",
        financial_statement_audit_status: "Audited",
        securities_offered_type: ["Equity (common or preferred stock)"],
        industry_group: "Other",
        status: existing?.status ?? "pending",
        as_of: filing_date || existing?.as_of || null,
      }));

    // 1-K: carries no tier/SIC — merges them forward from the existing row.
    const save1K = (filing_date: string) =>
      repo.saveOfferingAsOf(CIK, FN, filing_date, (existing) => ({
        cik: CIK,
        file_number: FN,
        issuer_name: existing?.issuer_name ?? null,
        jurisdiction: existing?.jurisdiction ?? null,
        sic_code: existing?.sic_code ?? null,
        tier: existing?.tier ?? null,
        financial_statement_audit_status: existing?.financial_statement_audit_status ?? null,
        securities_offered_type: existing?.securities_offered_type ?? null,
        industry_group: existing?.industry_group ?? null,
        status: "reporting",
        as_of: filing_date || existing?.as_of || null,
      }));

    it("merges a later 1-K onto the 1-A and skips a stale out-of-order replay", async () => {
      await save1A("2024-01-01");
      await save1K("2024-06-01");
      await save1A("2023-01-01"); // out-of-order older replay -> skipped

      const final = await repo.getOffering(CIK, FN);
      expect(final?.as_of).toBe("2024-06-01");
      expect(final?.status).toBe("reporting");
      expect(final?.tier).toBe("Tier2"); // merged forward, not clobbered to null
    });

    it("lets the newer filing win regardless of concurrent submission order", async () => {
      // The guarded invariant: the newest filing's as_of and authoritative
      // status win; the older 1-A can never lost-update them. (The merged tier
      // is order-dependent by design — only asserted in the sequential case.)
      for (const ops of [
        [save1A("2024-01-01"), save1K("2024-06-01")],
        [save1K("2024-06-01"), save1A("2024-01-01")],
      ]) {
        await Promise.all(ops);
        const final = await repo.getOffering(CIK, FN);
        expect(final?.as_of).toBe("2024-06-01");
        expect(final?.status).toBe("reporting");
      }
    });

    it("carries a multi-value securities_offered_type through a same-date replay", async () => {
      // A 1-A filer selecting several securities is the case the column was
      // widened AND re-typed for. `isStaleByAsOf` admits an equal date (an
      // amendment filed the same day), so a replay re-runs `build` — the list
      // has to survive that, element for element, not just the first write.
      const multi = [...ALL_SECURITIES_OFFERED_TYPES];
      const save = () =>
        repo.saveOfferingAsOf(CIK, FN, "2024-02-02", (existing) => ({
          cik: CIK,
          file_number: FN,
          issuer_name: "Multi Select Inc",
          jurisdiction: "DE",
          sic_code: null,
          tier: "Tier2",
          financial_statement_audit_status: null,
          securities_offered_type: existing?.securities_offered_type ?? multi,
          industry_group: null,
          status: "pending",
          as_of: "2024-02-02",
        }));

      await save();
      await save();

      const stored = (await repo.getOffering(CIK, FN))?.securities_offered_type;
      expect(Array.isArray(stored)).toBe(true);
      expect(stored).toHaveLength(multi.length);
      multi.forEach((value, i) => expect(stored?.[i]).toBe(value));
      // The very failure the re-type exists to prevent: a stringified literal
      // truncated at the old 100-char width.
      expect(multi.join(",").length).toBeGreaterThan(100);
    });
  });

  describe("Offering History", () => {
    it("should save and retrieve offering history", async () => {
      const history: RegAOfferingHistory = {
        cik: 12345,
        file_number: "024-00001",
        accession_number: "0001234567-24-000001",
        filing_date: "2024-03-15",
        qualification_date: "2024-02-01",
        commence_date: "2024-03-01",
        securities_qualified_sold: 1000,
        securities_sold: 500,
        price_per_security: 10.5,
        aggregate_offering_price: 50000,
        aggregate_offering_price_holders: null,
        issuer_aggregate_offering: null,
        security_holder_aggregate: null,
        qualification_offering_aggregate: null,
        concurrent_offering_aggregate: null,
        total_aggregate_offering: null,
        securities_offered: null,
        outstanding_securities: null,
        estimated_net_amount: 45000,
        crd_number: "12345",
      };

      await repo.saveOfferingHistory(history);
      const retrieved = await repo.getOfferingHistory(12345, "024-00001", "0001234567-24-000001");

      expect(retrieved).toBeDefined();
      expect(retrieved?.price_per_security).toBe(10.5);
      expect(retrieved?.estimated_net_amount).toBe(45000);
    });

    it("should retrieve histories by file number", async () => {
      await repo.saveOfferingHistory({
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-001",
        filing_date: "2024-01-15",
        qualification_date: null,
        commence_date: null,
        securities_qualified_sold: null,
        securities_sold: null,
        price_per_security: null,
        aggregate_offering_price: null,
        aggregate_offering_price_holders: null,
        issuer_aggregate_offering: null,
        security_holder_aggregate: null,
        qualification_offering_aggregate: null,
        concurrent_offering_aggregate: null,
        total_aggregate_offering: null,
        securities_offered: null,
        outstanding_securities: null,
        estimated_net_amount: null,
        crd_number: null,
      });
      await repo.saveOfferingHistory({
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-002",
        filing_date: "2024-06-15",
        qualification_date: null,
        commence_date: null,
        securities_qualified_sold: null,
        securities_sold: null,
        price_per_security: null,
        aggregate_offering_price: null,
        aggregate_offering_price_holders: null,
        issuer_aggregate_offering: null,
        security_holder_aggregate: null,
        qualification_offering_aggregate: null,
        concurrent_offering_aggregate: null,
        total_aggregate_offering: null,
        securities_offered: null,
        outstanding_securities: null,
        estimated_net_amount: null,
        crd_number: null,
      });

      const results = await repo.getOfferingHistoriesByFileNumber("024-00001");
      expect(results.length).toBe(2);
    });
  });

  describe("Service Providers", () => {
    it("should save and retrieve service providers", async () => {
      const provider: RegAServiceProvider = {
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-001",
        provider_type: "auditor",
        provider_name: "Big Four Auditors LLP",
        fees: 50000,
        crd: null,
      };

      await repo.saveServiceProvider(provider);
      const results = await repo.getServiceProvidersByFiling(12345, "024-00001", "acc-001");

      expect(results.length).toBe(1);
      expect(results[0].provider_name).toBe("Big Four Auditors LLP");
      expect(results[0].fees).toBe(50000);
    });
  });

  describe("Financial Data", () => {
    it("should save and retrieve financial data", async () => {
      const data: RegAFinancialData = {
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-001",
        field_name: "totalAssets",
        field_value: 1000000,
      };

      await repo.saveFinancialData(data);
      const results = await repo.getFinancialDataByFiling(12345, "024-00001", "acc-001");

      expect(results.length).toBe(1);
      expect(results[0].field_name).toBe("totalAssets");
      expect(results[0].field_value).toBe(1000000);
    });
  });

  describe("Equity Classes", () => {
    it("should save and retrieve equity classes", async () => {
      const equityClass: RegAEquityClass = {
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-001",
        equity_type: "common",
        class_name: "Class A Common Stock",
        outstanding: 5000000,
        cusip: "123456789",
        publicly_traded: "NASDAQ",
      };

      await repo.saveEquityClass(equityClass);
      const results = await repo.getEquityClassesByFiling(12345, "024-00001", "acc-001");

      expect(results.length).toBe(1);
      expect(results[0].class_name).toBe("Class A Common Stock");
      expect(results[0].outstanding).toBe(5000000);
    });
  });

  describe("Complete Data Retrieval", () => {
    it("should retrieve complete offering data", async () => {
      await repo.saveOffering({
        cik: 12345,
        file_number: "024-00001",
        issuer_name: "Complete Test Inc",
        jurisdiction: "DE",
        sic_code: 7372,
        tier: "Tier1",
        financial_statement_audit_status: "Audited",
        securities_offered_type: ["Equity (common or preferred stock)"],
        industry_group: "Other",
        status: "pending",
        as_of: null,
      });

      await repo.saveOfferingHistory({
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-001",
        filing_date: "2024-03-15",
        qualification_date: null,
        commence_date: null,
        securities_qualified_sold: null,
        securities_sold: null,
        price_per_security: 10.0,
        aggregate_offering_price: null,
        aggregate_offering_price_holders: null,
        issuer_aggregate_offering: 500000,
        security_holder_aggregate: 0,
        qualification_offering_aggregate: 0,
        concurrent_offering_aggregate: 0,
        total_aggregate_offering: 500000,
        securities_offered: 50000,
        outstanding_securities: null,
        estimated_net_amount: null,
        crd_number: null,
      });

      await repo.saveServiceProvider({
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-001",
        provider_type: "legal",
        provider_name: "Law Firm LLP",
        fees: 25000,
        crd: null,
      });

      await repo.saveFinancialData({
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-001",
        field_name: "netIncome",
        field_value: -50000,
      });

      await repo.saveEquityClass({
        cik: 12345,
        file_number: "024-00001",
        accession_number: "acc-001",
        equity_type: "common",
        class_name: "Common Stock",
        outstanding: 1000000,
        cusip: null,
        publicly_traded: null,
      });

      const complete = await repo.getCompleteOfferingData(12345, "024-00001", "acc-001");

      expect(complete.offering).toBeDefined();
      expect(complete.offering?.issuer_name).toBe("Complete Test Inc");
      expect(complete.history).toBeDefined();
      expect(complete.history?.price_per_security).toBe(10.0);
      expect(complete.serviceProviders.length).toBe(1);
      expect(complete.financialData.length).toBe(1);
      expect(complete.equityClasses.length).toBe(1);
    });
  });

  describe("Aggregates", () => {
    function makeOffering(overrides: Partial<RegAOffering> = {}): RegAOffering {
      return {
        cik: 1,
        file_number: "024-00001",
        issuer_name: "Issuer",
        jurisdiction: null,
        sic_code: null,
        tier: "Tier1",
        financial_statement_audit_status: null,
        securities_offered_type: null,
        industry_group: null,
        status: "pending",
        as_of: null,
        ...overrides,
      };
    }

    function makeHistory(overrides: Partial<RegAOfferingHistory> = {}): RegAOfferingHistory {
      return {
        cik: 1,
        file_number: "024-00001",
        accession_number: "0000000001-25-000001",
        filing_date: "2025-01-01",
        qualification_date: null,
        commence_date: null,
        securities_qualified_sold: null,
        securities_sold: null,
        price_per_security: null,
        aggregate_offering_price: null,
        aggregate_offering_price_holders: null,
        issuer_aggregate_offering: null,
        security_holder_aggregate: null,
        qualification_offering_aggregate: null,
        concurrent_offering_aggregate: null,
        total_aggregate_offering: null,
        securities_offered: null,
        outstanding_securities: null,
        estimated_net_amount: null,
        crd_number: null,
        ...overrides,
      };
    }

    it("filters offerings by tier", async () => {
      await repo.saveOffering(makeOffering({ cik: 1, file_number: "024-001", tier: "Tier1" }));
      await repo.saveOffering(
        makeOffering({ cik: 2, file_number: "024-002", tier: "Tier2", status: "reporting" })
      );

      const tier2 = await repo.getOfferingsByTier("Tier2");
      expect(tier2.length).toBe(1);
      expect(tier2[0].cik).toBe(2);
    });

    it("counts offerings by status and by tier", async () => {
      await repo.saveOffering(makeOffering({ cik: 1, file_number: "024-001", tier: "Tier1" }));
      await repo.saveOffering(
        makeOffering({ cik: 2, file_number: "024-002", tier: "Tier2", status: "reporting" })
      );
      await repo.saveOffering(
        makeOffering({ cik: 3, file_number: "024-003", tier: null, status: "reporting" })
      );

      const byStatus = await repo.countOfferingsByStatus();
      expect(byStatus.get("pending")).toBe(1);
      expect(byStatus.get("reporting")).toBe(2);

      const byTier = await repo.countOfferingsByTier();
      expect(byTier.get("Tier1")).toBe(1);
      expect(byTier.get("Tier2")).toBe(1);
      expect(byTier.get("unknown")).toBe(1);
    });

    it("buckets unexpected statuses under 'other'", async () => {
      await repo.saveOffering(makeOffering({ cik: 1, file_number: "024-001" }));
      await repo.saveOffering(
        makeOffering({ cik: 2, file_number: "024-002", status: "suspended" })
      );

      const byStatus = await repo.countOfferingsByStatus();
      expect(byStatus.get("pending")).toBe(1);
      expect(byStatus.get("other")).toBe(1);
    });

    it("sums the latest aggregate offering amount per offering for a CIK", async () => {
      await repo.saveOffering(
        makeOffering({ cik: 7, file_number: "024-010", tier: "Tier2", status: "reporting" })
      );
      // Two history snapshots for the same offering: only the latest counts.
      await repo.saveOfferingHistory(
        makeHistory({
          cik: 7,
          file_number: "024-010",
          accession_number: "0000000001-25-000001",
          filing_date: "2025-01-01",
          aggregate_offering_price: 1_000_000,
        })
      );
      await repo.saveOfferingHistory(
        makeHistory({
          cik: 7,
          file_number: "024-010",
          accession_number: "0000000001-25-000002",
          filing_date: "2025-06-01",
          total_aggregate_offering: 2_500_000,
        })
      );

      const total = await repo.latestAggregateOfferingByCik(7);
      expect(total).toBe(2_500_000);
    });

    it("breaks same-day ties by accession number and returns null when no amounts exist", async () => {
      await repo.saveOffering(
        makeOffering({ cik: 8, file_number: "024-020", tier: "Tier2", status: "reporting" })
      );
      // No history rows with amounts: null, not a fabricated $0.
      await repo.saveOfferingHistory(
        makeHistory({ cik: 8, file_number: "024-020", accession_number: "0000000001-25-000001" })
      );
      expect(await repo.latestAggregateOfferingByCik(8)).toBeNull();

      // Same filing_date, later accession wins deterministically.
      await repo.saveOfferingHistory(
        makeHistory({
          cik: 8,
          file_number: "024-020",
          accession_number: "0000000001-25-000002",
          filing_date: "2025-03-01",
          aggregate_offering_price: 100,
        })
      );
      await repo.saveOfferingHistory(
        makeHistory({
          cik: 8,
          file_number: "024-020",
          accession_number: "0000000001-25-000003",
          filing_date: "2025-03-01",
          aggregate_offering_price: 250,
        })
      );
      expect(await repo.latestAggregateOfferingByCik(8)).toBe(250);
    });

    it("scopes bucket counts to a CIK when one is given", async () => {
      await repo.saveOffering(makeOffering({ cik: 1, file_number: "024-001", tier: "Tier1" }));
      await repo.saveOffering(
        makeOffering({ cik: 2, file_number: "024-002", tier: "Tier2", status: "reporting" })
      );

      const byStatus = await repo.countOfferingsByStatus(2);
      expect(byStatus.get("reporting")).toBe(1);
      expect(byStatus.get("pending")).toBeUndefined();
      expect(await repo.countOfferings(2)).toBe(1);
    });
  });
});
