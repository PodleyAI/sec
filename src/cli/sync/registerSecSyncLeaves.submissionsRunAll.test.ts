/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSyncLeavesForTesting, EMPTY_SYNC_CONTEXT, getSyncLeaf } from "./syncLeaves";

/**
 * `withCli` decides what a run does with itself (draw Ink, report to a
 * watching parent, or run plainly) — these tests only care what `runAll`
 * hands the real `Workflow`, so bypass that decision and run the graph.
 */
vi.mock("@workglow/cli", () => ({
  withCli: vi.fn((wf: { run: (input?: unknown) => Promise<unknown> }) => ({
    run: (input?: unknown) => wf.run(input),
  })),
}));

const { calls } = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock("../../task/index/CatchUpDailyIndexTask", async () => {
  const { Task } = await import("workglow");
  const { Type } = await import("typebox");
  class FakeCatchUpDailyIndexTask extends Task {
    static readonly type = "FakeCatchUpDailyIndexTask";
    static inputSchema() {
      return Type.Object({
        from: Type.Optional(Type.String()),
        lookback: Type.Optional(Type.Number()),
      });
    }
    static outputSchema() {
      return Type.Object({ success: Type.Boolean() });
    }
    async execute(input: { from?: string; lookback?: number }) {
      calls.push(`index(from=${input.from},lookback=${input.lookback})`);
      return { success: true };
    }
  }
  return { CatchUpDailyIndexTask: FakeCatchUpDailyIndexTask };
});

vi.mock("../../task/submissions/UpdateAllSubmissionsTask", async () => {
  const { Task } = await import("workglow");
  const { Type } = await import("typebox");
  class FakeUpdateAllSubmissionsTask extends Task {
    static readonly type = "FakeUpdateAllSubmissionsTask";
    static inputSchema() {
      return Type.Object({ force: Type.Optional(Type.Boolean()) });
    }
    static outputSchema() {
      return Type.Object({ success: Type.Boolean() });
    }
    async execute(input: { force?: boolean }) {
      // `force` must survive the index task's dataflow edge unchanged — the
      // two tasks' ports must not collide, or a matching upstream output
      // name would silently override this default.
      calls.push(`submissions(force=${input.force})`);
      return { success: true };
    }
  }
  return { UpdateAllSubmissionsTask: FakeUpdateAllSubmissionsTask };
});

describe("submissions leaf runAll — index + submissions as one task graph", () => {
  afterEach(() => {
    clearSyncLeavesForTesting();
    calls.length = 0;
    vi.restoreAllMocks();
  });

  it("runs both steps, in order, in one graph, with force surviving the index task's output", async () => {
    const { registerSecSyncLeaves } = await import("./registerSecSyncLeaves");
    registerSecSyncLeaves();
    const leaf = getSyncLeaf("submissions");
    expect(leaf?.runAll).toBeDefined();

    await leaf!.runAll!({ ...EMPTY_SYNC_CONTEXT, force: true, from: "2026-01-01", lookback: 5 });

    expect(calls).toEqual(["index(from=2026-01-01,lookback=5)", "submissions(force=true)"]);
  });
});
