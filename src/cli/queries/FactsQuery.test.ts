import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { globalServiceRegistry } from "@workglow/util";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { queryFacts } from "./FactsQuery";

function makeFact(overrides: Partial<Parameters<typeof repo.put>[0]> = {}) {
  return {
    cik: 1318605,
    grouping: "us-gaap",
    name: "Revenue",
    filed_date: "2026-03-01",
    form: "10-K",
    val_unit: "USD",
    frame: null,
    accession_number: "0001-26-001",
    start_date: null,
    end_date: null,
    val: 1000000,
    fy: 2025,
    fp: "FY",
    ...overrides,
  };
}

let repo: ReturnType<typeof globalServiceRegistry.get<typeof COMPANY_FACTS_REPOSITORY_TOKEN>>;

describe("queryFacts", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
  });

  it("returns empty results for a CIK with no facts", async () => {
    const result = await queryFacts({ cik: 1318605 });
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns facts for a given CIK", async () => {
    await repo.put(makeFact({ cik: 1318605, accession_number: "0001-26-001" }));
    await repo.put(makeFact({ cik: 320193, accession_number: "0001-26-002" }));

    const result = await queryFacts({ cik: 1318605 });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(1318605);
  });

  it("filters by name (partial match)", async () => {
    await repo.put(makeFact({ name: "Revenue", accession_number: "0001-26-001" }));
    await repo.put(makeFact({ name: "NetIncome", accession_number: "0001-26-002" }));

    const result = await queryFacts({ cik: 1318605, name: "revenue" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe("Revenue");
  });

  it("filters by taxonomy (grouping)", async () => {
    await repo.put(makeFact({ grouping: "us-gaap", accession_number: "0001-26-001" }));
    await repo.put(makeFact({ grouping: "dei", accession_number: "0001-26-002" }));

    const result = await queryFacts({ cik: 1318605, taxonomy: "gaap" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].grouping).toBe("us-gaap");
  });

  it("filters by fiscal year", async () => {
    await repo.put(makeFact({ fy: 2025, accession_number: "0001-26-001", val: 100 }));
    await repo.put(makeFact({ fy: 2024, accession_number: "0001-26-002", val: 200 }));

    const result = await queryFacts({ cik: 1318605, year: 2025 });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].fy).toBe(2025);
  });

  it("respects limit and offset", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.put(
        makeFact({
          accession_number: `0001-26-${String(i).padStart(3, "0")}`,
          val: i * 1000,
        })
      );
    }

    const result = await queryFacts({ cik: 1318605, limit: 2, offset: 1 });
    expect(result.rows.length).toBe(2);
    expect(result.total).toBe(5);
  });
});
