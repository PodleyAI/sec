import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { globalServiceRegistry } from "@workglow/util";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { queryEntities } from "./EntityQuery";

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
});
