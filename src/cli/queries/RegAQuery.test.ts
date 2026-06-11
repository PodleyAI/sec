import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "../../storage/reg-a/RegAOfferingSchema";
import { queryRegAOfferings } from "./RegAQuery";

function makeOffering(overrides: Partial<Parameters<typeof repo.put>[0]> = {}) {
  return {
    cik: 1318605,
    file_number: "024-12345",
    issuer_name: "Acme Real Estate",
    jurisdiction: "DE",
    sic_code: null,
    tier: "Tier2",
    financial_statement_audit_status: "Audited",
    securities_offered_type: "Common Stock",
    industry_group: "Real Estate",
    status: "reporting",
    ...overrides,
  };
}

let repo: ReturnType<typeof globalServiceRegistry.get<typeof REGA_OFFERING_REPOSITORY_TOKEN>>;

describe("queryRegAOfferings", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN);
  });

  it("returns empty results for empty DB", async () => {
    const result = await queryRegAOfferings({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by CIK, tier, and status", async () => {
    await repo.put(makeOffering({ cik: 1, file_number: "024-001", tier: "Tier1", status: "pending" }));
    await repo.put(makeOffering({ cik: 2, file_number: "024-002", tier: "Tier2", status: "reporting" }));

    expect((await queryRegAOfferings({ cik: 1 })).rows.length).toBe(1);
    expect((await queryRegAOfferings({ tier: "Tier2" })).rows[0].cik).toBe(2);
    expect((await queryRegAOfferings({ status: "pending" })).rows[0].cik).toBe(1);
  });

  it("filters by search on issuer name (partial, case-insensitive)", async () => {
    await repo.put(makeOffering({ file_number: "024-001", issuer_name: "Acme Real Estate" }));
    await repo.put(makeOffering({ file_number: "024-002", issuer_name: "Beta Brewing" }));

    const result = await queryRegAOfferings({ search: "acme" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].issuer_name).toBe("Acme Real Estate");
  });

  it("respects limit and offset", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.put(makeOffering({ file_number: `024-${String(i).padStart(3, "0")}` }));
    }
    const result = await queryRegAOfferings({ limit: 2, offset: 1 });
    expect(result.rows.length).toBe(2);
    expect(result.total).toBe(5);
  });
});
