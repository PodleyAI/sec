import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import {
  INVESTMENT_OFFERING_REPOSITORY_TOKEN,
  type InvestmentOfferingRepositoryStorage,
} from "../../storage/investment-offering/InvestmentOfferingSchema";
import { queryOfferings } from "./OfferingQuery";

function makeOffering(overrides: Partial<Parameters<typeof repo.put>[0]> = {}) {
  return {
    cik: 1318605,
    file_number: "021-12345",
    industry_group: "Technology",
    industry_subgroup: null,
    date_of_first_sale: "2026-01-15",
    exemptions: null,
    is_debt_type: null,
    is_equity_type: null,
    is_mineral_property_type: null,
    is_option_to_aquire_type: null,
    is_pooled_investment_type: null,
    is_security_to_be_aquired: null,
    is_tenant_in_common: null,
    is_business_combination_type: null,
    is_other_type: null,
    description_of_other: null,
    as_of: null,
    ...overrides,
  };
}

let repo: InvestmentOfferingRepositoryStorage;

describe("queryOfferings", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = globalServiceRegistry.get(INVESTMENT_OFFERING_REPOSITORY_TOKEN);
  });

  it("returns empty results for empty DB", async () => {
    const result = await queryOfferings({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by CIK", async () => {
    await repo.put(makeOffering({ cik: 1318605, file_number: "021-001" }));
    await repo.put(makeOffering({ cik: 320193, file_number: "021-002" }));

    const result = await queryOfferings({ cik: 1318605 });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(1318605);
  });

  it("filters by industry (partial, case-insensitive)", async () => {
    await repo.put(makeOffering({ file_number: "021-001", industry_group: "Technology" }));
    await repo.put(makeOffering({ file_number: "021-002", industry_group: "Healthcare" }));

    const result = await queryOfferings({ industry: "tech" });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].industry_group).toBe("Technology");
  });

  it("filters by search on industry_group", async () => {
    await repo.put(makeOffering({ file_number: "021-001", industry_group: "Technology" }));
    await repo.put(makeOffering({ file_number: "021-002", industry_group: "Healthcare" }));

    const result = await queryOfferings({ search: "health" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].industry_group).toBe("Healthcare");
  });

  it("respects limit and offset", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.put(
        makeOffering({
          file_number: `021-${String(i).padStart(3, "0")}`,
        })
      );
    }

    const result = await queryOfferings({ limit: 2, offset: 1 });
    expect(result.rows.length).toBe(2);
    expect(result.total).toBe(5);
  });
});
