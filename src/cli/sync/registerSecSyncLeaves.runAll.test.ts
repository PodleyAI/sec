/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SYNC_CONTEXT, getSyncLeaf, clearSyncLeavesForTesting } from "./syncLeaves";

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

// Plain, import-free state shared with the (necessarily async, since
// `vi.mock` factories run before any top-level `import` in this file
// evaluates) mock factories below.
const { identifyCalls, processedCiks, ciksState } = vi.hoisted(() => ({
  identifyCalls: [] as Array<{ readonly full: boolean | undefined }>,
  processedCiks: [] as number[],
  ciksState: { current: [] as number[] },
}));

vi.mock("../../task/spac/IdentifySpacsTask", async () => {
  const { Task } = await import("workglow");
  const { Type } = await import("typebox");
  class FakeIdentifySpacsTask extends Task {
    static readonly type = "FakeIdentifySpacsTask";
    static inputSchema() {
      return Type.Object({ full: Type.Optional(Type.Boolean()) });
    }
    static outputSchema() {
      return Type.Object({ success: Type.Boolean() });
    }
    async execute(input: { full?: boolean }) {
      identifyCalls.push({ full: input.full });
      return { success: true };
    }
  }
  return { IdentifySpacsTask: FakeIdentifySpacsTask };
});

vi.mock("../../task/spac/ProcessSpacTimelineTask", async () => {
  const { Task } = await import("workglow");
  const { Type } = await import("typebox");
  /** cik === 2 stands in for an issuer whose replay failed. */
  class FakeProcessSpacTimelineTask extends Task {
    static readonly type = "FakeProcessSpacTimelineTask";
    static inputSchema() {
      return Type.Object({ cik: Type.Number(), filedOnOrAfter: Type.Optional(Type.String()) });
    }
    static outputSchema() {
      return Type.Object({
        cik: Type.Number(),
        matched: Type.Number(),
        processed: Type.Number(),
        partial: Type.Number(),
        failed: Type.Number(),
        nonfatal: Type.Number(),
        triage: Type.Number(),
        skipped: Type.Number(),
        triageExtractors: Type.String(),
        firstDate: Type.String(),
        lastDate: Type.String(),
        error: Type.String(),
      });
    }
    async execute(input: { cik: number; filedOnOrAfter?: string }) {
      processedCiks.push(input.cik);
      const failed = input.cik === 2 ? 1 : 0;
      return {
        cik: input.cik,
        matched: 1,
        processed: failed ? 0 : 1,
        partial: 0,
        failed,
        nonfatal: 0,
        triage: 0,
        skipped: 0,
        triageExtractors: "",
        firstDate: "",
        lastDate: "",
        error: "",
      };
    }
  }
  return { ProcessSpacTimelineTask: FakeProcessSpacTimelineTask };
});

vi.mock("./spacSyncCiks", () => ({
  listSpacProcessCiks: vi.fn(async () => ciksState.current),
  filterSpacCiksByHistory: vi.fn(async (ciks: readonly number[]) => [...ciks]),
  shardCiks: vi.fn((ciks: readonly number[]) => [...ciks]),
  spacUpdatesFiledOnOrAfter: vi.fn(async () => undefined),
}));

describe("spacs leaf runAll — identify + process as one task graph", () => {
  afterEach(() => {
    clearSyncLeavesForTesting();
    identifyCalls.length = 0;
    processedCiks.length = 0;
    vi.restoreAllMocks();
  });

  it("runs identify, then feeds the computed CIK list through the map/loop, and throws on failures", async () => {
    ciksState.current = [1, 2, 3];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { registerSecSyncLeaves } = await import("./registerSecSyncLeaves");
    registerSecSyncLeaves();
    const leaf = getSyncLeaf("spacs");
    expect(leaf?.runAll).toBeDefined();

    await expect(leaf!.runAll!({ ...EMPTY_SYNC_CONTEXT, full: true })).rejects.toThrow(
      "1 of 3 issuer(s) had failed filings"
    );

    expect(identifyCalls).toEqual([{ full: true }]);
    expect([...processedCiks].sort()).toEqual([1, 2, 3]);
  });

  it("does not throw and reports nothing to process when the computed CIK list is empty", async () => {
    ciksState.current = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { registerSecSyncLeaves } = await import("./registerSecSyncLeaves");
    registerSecSyncLeaves();
    const leaf = getSyncLeaf("spacs");

    await expect(leaf!.runAll!(EMPTY_SYNC_CONTEXT)).resolves.toBeUndefined();

    expect(identifyCalls).toEqual([{ full: false }]);
    expect(processedCiks).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith("No known SPACs or high/medium candidates");
  });
});
