/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { withModelOverrides } from "./data/models";
import { RunRegistry, type RunRecord } from "./runs";

async function settle(registry: RunRegistry, id: string): Promise<RunRecord> {
  for (let i = 0; i < 200; i++) {
    const run = registry.get(id)!;
    if (run.status !== "queued" && run.status !== "running") return run;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("run never settled");
}

describe("RunRegistry", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("runs one body at a time, in the order they were enqueued", async () => {
    const registry = new RunRegistry();
    const order: string[] = [];
    let firstRunning = false;
    const first = registry.enqueue({
      kind: "candidates",
      label: "first",
      body: async () => {
        firstRunning = true;
        await new Promise((r) => setTimeout(r, 25));
        order.push("first");
        firstRunning = false;
      },
    });
    const second = registry.enqueue({
      kind: "candidates",
      label: "second",
      body: async () => {
        // Serialization is a correctness requirement, not a nicety: the model
        // override is process-global env state, so an overlap would have each
        // run observing the other's model.
        expect(firstRunning).toBe(false);
        order.push("second");
      },
    });
    await settle(registry, second.id);
    expect(order).toEqual(["first", "second"]);
    expect((await settle(registry, first.id)).status).toBe("succeeded");
  });

  it("records a thrown body as failed and keeps the message", async () => {
    const registry = new RunRegistry();
    const run = registry.enqueue({
      kind: "candidates",
      label: "boom",
      body: async () => {
        throw new Error("nope");
      },
    });
    const settled = await settle(registry, run.id);
    expect(settled.status).toBe("failed");
    expect(settled.error).toBe("nope");
    expect(settled.events.some((e) => e.level === "error")).toBe(true);
  });

  it("cancels a queued run without ever starting it", async () => {
    const registry = new RunRegistry();
    let started = false;
    registry.enqueue({
      kind: "candidates",
      label: "blocker",
      body: () => new Promise((r) => setTimeout(r, 40)),
    });
    const queued = registry.enqueue({
      kind: "candidates",
      label: "cancelled",
      body: async () => {
        started = true;
      },
    });
    expect(registry.cancel(queued.id)).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(started).toBe(false);
    expect(registry.get(queued.id)!.status).toBe("cancelled");
  });

  it("reports the model overrides a run applied", async () => {
    const registry = new RunRegistry();
    const run = registry.enqueue({
      kind: "timeline",
      label: "with models",
      cik: 7,
      overrides: { s1: "claude-haiku-4-5" },
      body: async () => {},
    });
    await settle(registry, run.id);
    expect(registry.get(run.id)!.overrides).toEqual(["SEC_S1_MODEL=claude-haiku-4-5"]);
  });

  it("lists newest first and scopes runs to their issuer", async () => {
    const registry = new RunRegistry();
    registry.enqueue({ kind: "timeline", label: "a", cik: 1, body: async () => {} });
    const b = registry.enqueue({ kind: "timeline", label: "b", cik: 2, body: async () => {} });
    await settle(registry, b.id);
    expect(registry.list().map((r) => r.label)).toEqual(["b", "a"]);
    expect(
      registry
        .list()
        .filter((r) => r.cik === 1)
        .map((r) => r.label)
    ).toEqual(["a"]);
  });
});

describe("withModelOverrides", () => {
  it("restores a variable that was previously unset by deleting it", async () => {
    delete process.env.SEC_S1_MODEL;
    await withModelOverrides({ s1: "claude-haiku-4-5" }, async () => {
      expect(process.env.SEC_S1_MODEL).toBe("claude-haiku-4-5");
    });
    // Setting it back to "" would read as "unset" to `modelIdsFromEnv` but as a
    // configured empty value to the startup registration, and nothing would
    // show an operator the difference.
    expect("SEC_S1_MODEL" in process.env).toBe(false);
  });

  it("restores a previous value, including after the body throws", async () => {
    process.env.SEC_S1_MODEL = "claude-opus-5";
    await expect(
      withModelOverrides({ s1: "claude-haiku-4-5" }, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(process.env.SEC_S1_MODEL).toBe("claude-opus-5");
    delete process.env.SEC_S1_MODEL;
  });

  it("ignores an unknown slot rather than setting an arbitrary variable", async () => {
    await withModelOverrides({ "not-a-slot": "x" }, async () => {
      expect(process.env["not-a-slot"]).toBeUndefined();
    });
  });
});
