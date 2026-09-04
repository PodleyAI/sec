import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type ServiceToken } from "workglow";
import { SEC_STORAGE_REGISTRY } from "../../config/storageRegistry";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { getDbStats, getDbStatus, type CountableRepository } from "./DbStatus";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";

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
    expect(result.documentCount).toBe(0);
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

/**
 * Rebinds a counted table's repository so `size()` always rejects with `error`,
 * the way a storage does when its relation was never created.
 */
function bindFailingTable(token: ServiceToken<CountableRepository>, error: unknown): void {
  const failing: CountableRepository = {
    size: async (): Promise<number> => {
      throw error;
    },
  };
  globalServiceRegistry.registerInstance(token, failing);
}

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

  it("names the physical relation for every built-in table", async () => {
    // The Postgres estimate path filters on `relid = to_regclass($1)`, which
    // matches nothing when the name is a display label rather than the real
    // relation (`entity` for `entities`, `filing` for `filings`) — the count
    // then silently degrades to the exact scan the estimate exists to avoid.
    const registered = new Set(SEC_STORAGE_REGISTRY.map((storage) => storage.table));
    const reported = (await getDbStats()).map((stat) => stat.table);

    expect(reported.length).toBeGreaterThan(0);
    expect(reported.filter((table) => !registered.has(table))).toEqual([]);
  });

  it("reports n/a instead of throwing when a registered extension table is missing", async () => {
    // The report runs against a database set up before this table existed.
    // Losing every other row count to one uncreated relation is the bug.
    bindFailingTable(FILING_REPOSITORY_TOKEN, new Error("SQLITE_ERROR: no such table: filings"));

    const stats = await getDbStats();
    const missing = stats.find((stat) => stat.table === "filings");

    expect(missing).toEqual({ table: "filings", rows: null, estimated: false });
    const others = stats.filter((stat) => stat.table !== "filings");
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((stat) => typeof stat.rows === "number")).toBe(true);
  });

  it("reports n/a for the Postgres form of a missing relation", async () => {
    const error = Object.assign(new Error(`relation "filings" does not exist`), {
      code: "42P01",
    });
    bindFailingTable(FILING_REPOSITORY_TOKEN, error);

    const stats = await getDbStats();
    expect(stats.find((stat) => stat.table === "filings")?.rows).toBeNull();
  });

  it("rethrows a failure that is not a missing relation", async () => {
    // The guard must stay narrow: a database that is down is not a table that
    // has not been created, and reporting it as `n/a` would hide an outage.
    bindFailingTable(FILING_REPOSITORY_TOKEN, new Error("connect ECONNREFUSED 127.0.0.1:5432"));

    await expect(getDbStats()).rejects.toThrow(/ECONNREFUSED/);
  });

  it("reports progress through every counted table", async () => {
    const progress: Array<[number, string]> = [];
    await getDbStats((value, message) => {
      progress.push([value, message]);
    });

    expect(progress.length).toBeGreaterThan(0);
    // First and last are the registry's first and last entries, so the pair
    // also asserts the report walks the whole list rather than a prefix.
    const [first] = SEC_STORAGE_REGISTRY;
    const last = SEC_STORAGE_REGISTRY.at(-1);
    expect(progress[0]).toEqual([0, expect.stringContaining(`counting ${first!.table}`)]);
    expect(progress.at(-1)).toEqual([100, expect.stringContaining(`counted ${last!.table}`)]);
  });
});
