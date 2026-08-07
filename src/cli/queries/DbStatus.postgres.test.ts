/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";

/**
 * The Postgres estimate path, exercised without a Postgres.
 *
 * `resolveSqlBackend` routes an in-memory repository to `"repository"` on
 * purpose (a fast path would read a different store), so the estimate branch is
 * unreachable in a normal unit test — the backend decision and the pool are both
 * stubbed here. They live in their own file because the stubs are module-wide
 * and would otherwise change every other `DbStatus` assertion.
 */
const queries: { text: string; values: unknown[] }[] = [];
let estimateByTable: (table: string) => string | number | undefined = () => undefined;

vi.mock("../../util/sqlBackend", () => ({
  resolveSqlBackend: () => "postgres",
}));

vi.mock("../../util/pg", () => ({
  getPgPool: () => ({
    query: async (text: string, values: unknown[]) => {
      queries.push({ text, values });
      const estimated_count = estimateByTable(String(values[0]));
      return { rows: estimated_count === undefined ? [] : [{ estimated_count }] };
    },
  }),
}));

const { getDbStats, getDbStatus } = await import("./DbStatus");

async function seedOneEntity(): Promise<void> {
  await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).put({
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
}

describe("the Postgres row-count estimate", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    queries.length = 0;
    estimateByTable = () => undefined;
  });

  it("qualifies the relation name to current_schema()", async () => {
    // An unqualified `to_regclass('filings')` resolves through `search_path`, so
    // on a deployment whose path lists a staging schema first it binds the OTHER
    // schema's table and reports its count under sec's name.
    estimateByTable = () => 42;
    await getDbStatus();

    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.text).toContain("current_schema()");
      // Still parameterized: the table name is a bind value, never interpolated.
      expect(query.text).toContain("$1");
      expect(query.values).toHaveLength(1);
    }
  });

  it("falls back to the exact count when the estimate is zero", async () => {
    // `n_live_tup` is 0 until the first ANALYZE, so right after `sec bootstrap`
    // bulk-loads a table the estimate says 0 for a table with rows in it.
    await seedOneEntity();
    estimateByTable = () => 0;

    const status = await getDbStatus();
    expect(status.entityCount).toBe(1);
    expect(status.estimated).toBe(false);
  });

  it("reports a non-zero estimate and marks the result estimated", async () => {
    await seedOneEntity();
    estimateByTable = (table) => (table === "entities" ? 1_000_000 : 0);

    const status = await getDbStatus();
    expect(status.entityCount).toBe(1_000_000);
    expect(status.estimated).toBe(true);
    // Every other metric fell back to its exact count.
    expect(status.filingCount).toBe(0);
  });

  it("marks only the estimated rows in the per-table report", async () => {
    await seedOneEntity();
    estimateByTable = (table) => (table === "entities" ? 1_000_000 : 0);

    const stats = await getDbStats();
    expect(stats.find((stat) => stat.table === "entities")).toEqual({
      table: "entities",
      rows: 1_000_000,
      estimated: true,
    });
    expect(stats.find((stat) => stat.table === "filings")).toEqual({
      table: "filings",
      rows: 0,
      estimated: false,
    });
  });

  it("uses the exact count for every table under --exact", async () => {
    await seedOneEntity();
    estimateByTable = () => 1_000_000;

    const status = await getDbStatus({ exact: true });
    expect(status.entityCount).toBe(1);
    expect(status.estimated).toBe(false);
    expect(queries).toHaveLength(0);
  });
});
