import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceToken, globalServiceRegistry } from "workglow";
import { SEC_STORAGE_REGISTRY } from "../../config/storageRegistry";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import {
  getDbStats,
  getDbStatus,
  registerDbStatsTables,
  resetDbStatsTablesForTesting,
  type CountableRepository,
} from "./DbStatus";

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

/**
 * Registers a `db stats` extension table whose `size()` always rejects with
 * `error`, the way a storage does when its relation was never created.
 */
function registerFailingExtensionTable(table: string, error: unknown): void {
  const token = createServiceToken<CountableRepository>(`test.dbstats.${table}`);
  globalServiceRegistry.registerInstance(token, {
    size: async (): Promise<number> => {
      throw error;
    },
  });
  registerDbStatsTables([{ table, token }]);
}

describe("getDbStats", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  // Registration is process-global: an extension table left registered would
  // change the report every later assertion in this file reads.
  afterEach(() => {
    resetDbStatsTablesForTesting();
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
    // A downstream package registers a table, then the report runs against a
    // database that was set up before that table existed. Losing every other
    // row count — sec's own included — to one uncreated relation is the bug.
    registerFailingExtensionTable(
      "ext_missing",
      new Error("SQLITE_ERROR: no such table: ext_missing")
    );

    const stats = await getDbStats();
    const missing = stats.find((stat) => stat.table === "ext_missing");

    expect(missing).toEqual({ table: "ext_missing", rows: null, estimated: false });
    const builtIns = stats.filter((stat) => stat.table !== "ext_missing");
    expect(builtIns.length).toBeGreaterThan(0);
    expect(builtIns.every((stat) => typeof stat.rows === "number")).toBe(true);
  });

  it("reports n/a for the Postgres form of a missing relation", async () => {
    const error = Object.assign(new Error(`relation "ext_missing_pg" does not exist`), {
      code: "42P01",
    });
    registerFailingExtensionTable("ext_missing_pg", error);

    const stats = await getDbStats();
    expect(stats.find((stat) => stat.table === "ext_missing_pg")?.rows).toBeNull();
  });

  it("rethrows a failure that is not a missing relation", async () => {
    // The guard must stay narrow: a database that is down is not a table that
    // has not been created, and reporting it as `n/a` would hide an outage.
    registerFailingExtensionTable(
      "ext_unreachable",
      new Error("connect ECONNREFUSED 127.0.0.1:5432")
    );

    await expect(getDbStats()).rejects.toThrow(/ECONNREFUSED/);
  });

  it("reports progress through every counted table", async () => {
    const progress: Array<[number, string]> = [];
    await getDbStats((value, message) => {
      progress.push([value, message]);
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0]).toEqual([0, expect.stringContaining("counting cik_names")]);
    expect(progress.at(-1)).toEqual([100, expect.stringContaining("counted form144_recent_sales")]);
  });
});
