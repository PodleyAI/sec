import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { CROWDFUNDING_REPOSITORY_TOKEN } from "../../storage/portal/CrowdfundingSchema";
import { queryCrowdfunding } from "./CrowdfundingQuery";

function makeCrowdfunding(overrides: Partial<Parameters<typeof repo.put>[0]> = {}) {
  return {
    cik: 1318605,
    file_number: "020-12345",
    filing_date: "2026-03-01",
    name: "Acme Corp",
    legal_status: "Corporation",
    state_jurisdiction: "DE",
    date_incorporation: "2020-01-01",
    url: "https://acme.example.com",
    portal_cik: 9999999,
    status: "active",
    progress_update: null,
    nature_of_amendment: null,
    ...overrides,
  };
}

let repo: ReturnType<typeof globalServiceRegistry.get<typeof CROWDFUNDING_REPOSITORY_TOKEN>>;

describe("queryCrowdfunding", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    repo = globalServiceRegistry.get(CROWDFUNDING_REPOSITORY_TOKEN);
  });

  it("returns empty results for empty DB", async () => {
    const result = await queryCrowdfunding({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by CIK", async () => {
    await repo.put(makeCrowdfunding({ cik: 1318605, file_number: "020-001" }));
    await repo.put(makeCrowdfunding({ cik: 320193, file_number: "020-002" }));

    const result = await queryCrowdfunding({ cik: 1318605 });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(1318605);
  });

  it("filters by search on name (partial, case-insensitive)", async () => {
    await repo.put(makeCrowdfunding({ file_number: "020-001", name: "Acme Corp" }));
    await repo.put(makeCrowdfunding({ file_number: "020-002", name: "Beta Inc" }));

    const result = await queryCrowdfunding({ search: "acme" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe("Acme Corp");
  });

  it("filters by portal CIK", async () => {
    await repo.put(makeCrowdfunding({ file_number: "020-001", portal_cik: 9999999 }));
    await repo.put(makeCrowdfunding({ file_number: "020-002", portal_cik: 8888888 }));

    const result = await queryCrowdfunding({ portal: 9999999 });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].portal_cik).toBe(9999999);
  });

  it("filters by date range", async () => {
    await repo.put(makeCrowdfunding({ file_number: "020-001", filing_date: "2026-01-15" }));
    await repo.put(makeCrowdfunding({ file_number: "020-002", filing_date: "2026-03-15" }));

    const result = await queryCrowdfunding({ after: "2026-02-01" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].filing_date).toBe("2026-03-15");
  });

  it("respects limit and offset", async () => {
    for (let i = 1; i <= 5; i++) {
      await repo.put(
        makeCrowdfunding({
          file_number: `020-${String(i).padStart(3, "0")}`,
        })
      );
    }

    const result = await queryCrowdfunding({ limit: 2, offset: 1 });
    expect(result.rows.length).toBe(2);
    expect(result.total).toBe(5);
  });
});
