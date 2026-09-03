import { Value } from "typebox/value";
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import type { CountableRepository } from "../../cli/queries/DbStatus";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import {
  PORTAL_REPOSITORY_TOKEN,
  type PortalRepositoryStorage,
} from "../../storage/portal/PortalSchema";
import { DbStatsTask } from "./DbStatsTask";

describe("DbStatsTask", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  // The declared port schema is what downstream graph wiring reads, so the
  // degraded (`rows: null`) count has to be part of the contract, not just a
  // value the execute() happens to return.
  it("declares the null row count and the estimate flag in its output schema", () => {
    const degraded = { tables: [{ table: "portals", rows: null, estimated: false }] };
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
    const failing: CountableRepository = {
      size: async (): Promise<number> => {
        throw new Error("SQLITE_ERROR: no such table: portals");
      },
    };
    globalServiceRegistry.registerInstance(
      PORTAL_REPOSITORY_TOKEN,
      failing as unknown as PortalRepositoryStorage
    );

    const output = await new DbStatsTask().run();

    expect(output.tables.find((stat) => stat.table === "portals")?.rows).toBeNull();
    expect(Value.Check(DbStatsTask.outputSchema(), output)).toBe(true);
  });
});
