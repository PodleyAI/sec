/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSyncLeavesForTesting,
  EMPTY_SYNC_CONTEXT,
  getSyncLeaf,
  listSyncLeaves,
  registerSyncLeaf,
  runSyncLeaves,
  type SyncLeaf,
  type SyncRunContext,
  type SyncStep,
} from "./syncLeaves";
import { registerSecSyncLeaves } from "./registerSecSyncLeaves";

function makeStep(id: string, run: SyncStep["run"] = async () => {}): SyncStep {
  return { id, title: id, run };
}

function makeLeaf(
  id: string,
  steps: readonly SyncStep[],
  overrides: Partial<Pick<SyncLeaf, "description" | "order" | "inAll">> = {}
): SyncLeaf {
  return {
    id,
    description: id,
    order: 0,
    inAll: true,
    steps,
    ...overrides,
  };
}

describe("syncLeaves registry", () => {
  beforeEach(() => {
    clearSyncLeavesForTesting();
  });

  it("getSyncLeaf returns a registered leaf; unknown id is undefined", () => {
    const leaf = makeLeaf("facts", [makeStep("fetch")]);
    registerSyncLeaf(leaf);

    expect(getSyncLeaf("facts")).toBe(leaf);
    expect(getSyncLeaf("unknown")).toBeUndefined();
  });

  it("listSyncLeaves returns leaves sorted by order ascending, then id", () => {
    registerSyncLeaf(makeLeaf("later", [], { order: 20 }));
    registerSyncLeaf(makeLeaf("earlier", [], { order: 10 }));

    expect(listSyncLeaves().map((leaf) => leaf.order)).toEqual([10, 20]);
  });

  it("re-registering the same id replaces the previous leaf", () => {
    const first = makeLeaf("facts", [makeStep("one")], { description: "first" });
    const second = makeLeaf("facts", [makeStep("two")], { description: "second" });

    registerSyncLeaf(first);
    registerSyncLeaf(second);

    expect(getSyncLeaf("facts")).toBe(second);
    expect(getSyncLeaf("facts")?.description).toBe("second");
  });

  it("registerSecSyncLeaves pins sync all leaf identity", () => {
    registerSecSyncLeaves();

    expect(
      listSyncLeaves()
        .filter((l) => l.inAll)
        .map((l) => l.id)
    ).toEqual(["submissions", "facts", "portals", "crowdfunding", "reg-a", "spacs"]);
  });
});

describe("runSyncLeaves", () => {
  beforeEach(() => {
    clearSyncLeavesForTesting();
  });

  it("runs steps in leaf order and stops on first throw", async () => {
    const order: string[] = [];
    const ctx: SyncRunContext = EMPTY_SYNC_CONTEXT;

    registerSyncLeaf(
      makeLeaf("a", [
        makeStep("a1", async () => {
          order.push("a1");
        }),
        makeStep("a2", async () => {
          order.push("a2");
          throw new Error("boom");
        }),
        makeStep("a3", async () => {
          order.push("a3");
        }),
      ])
    );
    registerSyncLeaf(
      makeLeaf("b", [
        makeStep("b1", async () => {
          order.push("b1");
        }),
      ])
    );

    await expect(runSyncLeaves(["a", "b"], ctx, undefined)).rejects.toThrow("boom");
    expect(order).toEqual(["a1", "a2"]);
  });

  it("runs only the requested step when stepId is defined", async () => {
    const order: string[] = [];
    const ctx: SyncRunContext = EMPTY_SYNC_CONTEXT;

    registerSyncLeaf(
      makeLeaf("multi", [
        makeStep("one", async () => {
          order.push("one");
        }),
        makeStep("two", async () => {
          order.push("two");
        }),
        makeStep("three", async () => {
          order.push("three");
        }),
      ])
    );

    await runSyncLeaves(["multi"], ctx, "two");
    expect(order).toEqual(["two"]);
  });

  it("throws when stepId is unknown, listing valid step ids", async () => {
    const ctx: SyncRunContext = EMPTY_SYNC_CONTEXT;

    registerSyncLeaf(makeLeaf("multi", [makeStep("one"), makeStep("two"), makeStep("three")]));

    await expect(runSyncLeaves(["multi"], ctx, "nope")).rejects.toThrow(
      /Unknown --step 'nope' for sync multi/
    );
    await expect(runSyncLeaves(["multi"], ctx, "nope")).rejects.toThrow(/one, two, three/);
  });

  it("throws when leaf id is unknown", async () => {
    const ctx: SyncRunContext = EMPTY_SYNC_CONTEXT;

    await expect(runSyncLeaves(["missing"], ctx, undefined)).rejects.toThrow(
      /Unknown sync leaf 'missing'/
    );
  });
});

describe("runSyncLeaves runAll", () => {
  afterEach(() => {
    clearSyncLeavesForTesting();
  });

  it("runs a leaf as one unit when no step narrows it", async () => {
    const calls: string[] = [];
    registerSyncLeaf({
      id: "batched",
      description: "test",
      order: 1,
      inAll: true,
      steps: [
        { id: "a", title: "A", run: async () => void calls.push("step:a") },
        { id: "b", title: "B", run: async () => void calls.push("step:b") },
      ],
      runAll: async () => void calls.push("all"),
    });

    await runSyncLeaves(["batched"], EMPTY_SYNC_CONTEXT, undefined);
    // One call, so one task graph — which is what a watching console renders as
    // a single run instead of one run per step replacing the last.
    expect(calls).toEqual(["all"]);
  });

  it("still runs the one step a --step names, not the whole leaf", async () => {
    const calls: string[] = [];
    registerSyncLeaf({
      id: "batched",
      description: "test",
      order: 1,
      inAll: true,
      steps: [
        { id: "a", title: "A", run: async () => void calls.push("step:a") },
        { id: "b", title: "B", run: async () => void calls.push("step:b") },
      ],
      runAll: async () => void calls.push("all"),
    });

    await runSyncLeaves(["batched"], EMPTY_SYNC_CONTEXT, "b");
    expect(calls).toEqual(["step:b"]);
  });
});
