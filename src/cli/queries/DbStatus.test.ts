import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { getDbStats, getDbStatus } from "./DbStatus";

describe("getDbStatus", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns zero counts for empty db", async () => {
    const result = await getDbStatus();
    expect(result.entityCount).toBe(0);
    expect(result.filingCount).toBe(0);
    expect(result.factsCount).toBe(0);
    expect(result.processedSubmissions).toBe(0);
    expect(result.processedFacts).toBe(0);
    expect(result.extractorRuns).toBe(0);
  });

  it("counts entities after insertion", async () => {
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

    const result = await getDbStatus();
    expect(result.entityCount).toBe(1);
  });
});

describe("getDbStats", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns array of table stats", async () => {
    const result = await getDbStats();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(10);
  });

  it("each stat has table and rows properties", async () => {
    const result = await getDbStats();
    for (const stat of result) {
      expect(typeof stat.table).toBe("string");
      expect(typeof stat.rows).toBe("number");
    }
  });

  it("reports progress through every counted table", async () => {
    const progress: Array<[number, string]> = [];
    await getDbStats((value, message) => progress.push([value, message]));

    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toEqual([0, expect.stringContaining("counting cik_names")]);
    expect(progress.at(-1)).toEqual([100, expect.stringContaining("counted form144_recent_sales")]);
  });
});
