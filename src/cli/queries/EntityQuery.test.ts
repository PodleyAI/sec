import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { queryEntities } from "./EntityQuery";

function makeEntity(cik: number, name: string | null) {
  return {
    cik,
    name,
    type: null,
    sic: null,
    ein: null,
    description: null,
    website: null,
    investor_website: null,
    category: null,
    fiscal_year: null,
    state_incorporation: null,
    state_incorporation_desc: null,
  };
}

describe("queryEntities", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns empty array and total 0 for empty DB", async () => {
    const result = await queryEntities({});
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("returns entities after insertion", async () => {
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    await repo.put({
      cik: 1318605,
      name: "Tesla, Inc.",
      type: null,
      sic: 3711,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "TX",
      state_incorporation_desc: null,
    });

    const result = await queryEntities({});
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].cik).toBe(1318605);
    expect(result.rows[0].name).toBe("Tesla, Inc.");
  });

  it("filters by CIK (exact match)", async () => {
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    await repo.put({
      cik: 1318605,
      name: "Tesla, Inc.",
      type: null,
      sic: 3711,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "TX",
      state_incorporation_desc: null,
    });
    await repo.put({
      cik: 320193,
      name: "Apple Inc.",
      type: null,
      sic: 3571,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "CA",
      state_incorporation_desc: null,
    });

    const result = await queryEntities({ cik: 1318605 });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].name).toBe("Tesla, Inc.");
  });

  it("filters by name search (partial, case-insensitive)", async () => {
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    await repo.put({
      cik: 1318605,
      name: "Tesla, Inc.",
      type: null,
      sic: 3711,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "TX",
      state_incorporation_desc: null,
    });
    await repo.put({
      cik: 320193,
      name: "Apple Inc.",
      type: null,
      sic: 3571,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "CA",
      state_incorporation_desc: null,
    });

    const result = await queryEntities({ search: "tesla" });
    expect(result.rows.length).toBe(1);
    expect(result.total).toBe(1);
    expect(result.rows[0].name).toBe("Tesla, Inc.");
  });

  it("respects limit and offset", async () => {
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    for (let i = 1; i <= 5; i++) {
      await repo.put({
        cik: i,
        name: `Entity ${i}`,
        type: null,
        sic: null,
        ein: null,
        description: null,
        website: null,
        investor_website: null,
        category: null,
        fiscal_year: null,
        state_incorporation: null,
        state_incorporation_desc: null,
      });
    }

    const result = await queryEntities({ limit: 2, offset: 1 });
    expect(result.rows.length).toBe(2);
    expect(result.total).toBe(5);
  });

  it("total count reflects unsliced results", async () => {
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    for (let i = 1; i <= 10; i++) {
      await repo.put({
        cik: i,
        name: `Entity ${i}`,
        type: null,
        sic: null,
        ein: null,
        description: null,
        website: null,
        investor_website: null,
        category: null,
        fiscal_year: null,
        state_incorporation: null,
        state_incorporation_desc: null,
      });
    }

    const result = await queryEntities({ limit: 3 });
    expect(result.rows.length).toBe(3);
    expect(result.total).toBe(10);
  });

  it("streamed search reports the FULL match count, not offset+limit", async () => {
    // Regression: collectPage used to stop at offset+limit and report
    // that as total, so total was a constant equal to the page end. Now
    // it counts every match. 20 entities match "acme"; with limit 3 the
    // window has 3 rows but total must be the full 20, and because the
    // stream drained well under the cap totalApprox must be undefined.
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    for (let i = 1; i <= 20; i++) {
      await repo.put(makeEntity(i, `Acme ${i}`));
    }
    await repo.put(makeEntity(999, "Globex"));

    const result = await queryEntities({ search: "acme", limit: 3, offset: 0 });
    expect(result.rows.length).toBe(3);
    expect(result.total).toBe(20);
    expect(result.totalApprox).toBeUndefined();
  });

  it("filters by SIC code", async () => {
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    await repo.put({
      cik: 1318605,
      name: "Tesla, Inc.",
      type: null,
      sic: 3711,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "TX",
      state_incorporation_desc: null,
    });
    await repo.put({
      cik: 320193,
      name: "Apple Inc.",
      type: null,
      sic: 3571,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "CA",
      state_incorporation_desc: null,
    });

    const result = await queryEntities({ sic: 3711 });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe("Tesla, Inc.");
  });

  it("filters by state", async () => {
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    await repo.put({
      cik: 1318605,
      name: "Tesla, Inc.",
      type: null,
      sic: 3711,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "TX",
      state_incorporation_desc: null,
    });
    await repo.put({
      cik: 320193,
      name: "Apple Inc.",
      type: null,
      sic: 3571,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: "CA",
      state_incorporation_desc: null,
    });

    const result = await queryEntities({ state: "CA" });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe("Apple Inc.");
  });

  it("throws for invalid sort field", async () => {
    expect(queryEntities({ sort: "nonexistent_field" })).rejects.toThrow(
      'Invalid sort field "nonexistent_field"'
    );
  });

  it("accepts valid sort fields without throwing", async () => {
    const result = await queryEntities({ sort: "name" });
    expect(result).toBeDefined();
  });

  it("respects offset on the sorted-no-criteria path", async () => {
    // Regression: an earlier implementation used queryPage({}, {orderBy,
    // limit}) which is cursor-based and ignores offset, so `--offset 2`
    // silently returned the first page. Use getAll({orderBy, limit,
    // offset}) which pushes OFFSET down to SQL.
    const repo = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
    for (let i = 1; i <= 5; i++) {
      await repo.put({
        cik: i,
        name: `Co ${String.fromCharCode(64 + i)}`, // "Co A", "Co B", ...
        type: null,
        sic: null,
        ein: null,
        description: null,
        website: null,
        investor_website: null,
        category: null,
        fiscal_year: null,
        state_incorporation: null,
        state_incorporation_desc: null,
      });
    }

    const page1 = await queryEntities({ sort: "name", limit: 2, offset: 0 });
    expect(page1.rows.map((r) => r.name)).toEqual(["Co A", "Co B"]);
    expect(page1.total).toBe(5);

    const page2 = await queryEntities({ sort: "name", limit: 2, offset: 2 });
    expect(page2.rows.map((r) => r.name)).toEqual(["Co C", "Co D"]);
    expect(page2.total).toBe(5);
  });
});
