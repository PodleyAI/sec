import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServiceToken, globalServiceRegistry } from "workglow";
import {
  registerDbStatsTables,
  resetDbStatsTablesForTesting,
  type CountableRepository,
} from "../../cli/queries/DbStatus";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { DbStatsTask } from "./DbStatsTask";

describe("DbStatsTask", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());
  afterEach(() => resetDbStatsTablesForTesting());

  // The declared port schema is what downstream graph wiring reads, so the
  // degraded (`rows: null`) count has to be part of the contract, not just a
  // value the execute() happens to return.
  it("declares the null row count and the estimate flag in its output schema", () => {
    const degraded = { tables: [{ table: "ext_missing", rows: null, estimated: false }] };
    expect(Value.Check(DbStatsTask.outputSchema(), degraded)).toBe(true);
    expect(
      Value.Check(DbStatsTask.outputSchema(), {
        tables: [{ table: "t", rows: 3, estimated: true }],
      })
    ).toBe(true);
    // `estimated` is part of the contract, not an optional extra: a consumer
    // that cannot tell an estimate from a count is the bug this closes.
    expect(Value.Check(DbStatsTask.outputSchema(), { tables: [{ table: "t", rows: 3 }] })).toBe(
      false
    );
  });

  it("reports a null row count for a table the database has not created", async () => {
    const token = createServiceToken<CountableRepository>("test.dbstatstask.missing");
    globalServiceRegistry.registerInstance(token, {
      size: async (): Promise<number> => {
        throw new Error("SQLITE_ERROR: no such table: ext_missing");
      },
    });
    registerDbStatsTables([{ table: "ext_missing", token }]);

    const output = await new DbStatsTask().run();

    expect(output.tables.find((stat) => stat.table === "ext_missing")?.rows).toBeNull();
    expect(Value.Check(DbStatsTask.outputSchema(), output)).toBe(true);
  });
});
