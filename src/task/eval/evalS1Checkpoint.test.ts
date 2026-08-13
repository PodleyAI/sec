/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { EvalS1SectionTask } from "./EvalS1SectionTask";
import {
  beginEvalS1Sweep,
  checkpointEvalS1Results,
  drainEvalS1Sweep,
  type OracleRunResult,
} from "./evalS1Run";

function row(filing: string, model: string): OracleRunResult {
  return {
    filing,
    extractor: "management",
    model,
    ok: true,
    error: undefined,
    latencyMs: 1,
    rows: 1,
    cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
    score: null,
    raw: undefined,
  };
}

describe("eval s1 sweep checkpoint", () => {
  beforeEach(() => {
    beginEvalS1Sweep();
  });

  it("hands back everything checkpointed so far, in completion order", () => {
    // Ctrl-C partway through a ~400-section golden sweep discarded every
    // completed section: the map drops a run's partial output on abort, and
    // each of those rows was a real, paid-for API call.
    checkpointEvalS1Results([row("a", "claude-haiku-4-5")]);
    checkpointEvalS1Results([row("b", "claude-haiku-4-5"), row("b", "golden")]);

    expect(drainEvalS1Sweep().map((r) => `${r.filing}/${r.model}`)).toEqual([
      "a/claude-haiku-4-5",
      "b/claude-haiku-4-5",
      "b/golden",
    ]);
  });

  it("drains destructively, so a second sweep never inherits the first's rows", () => {
    checkpointEvalS1Results([row("a", "m")]);
    expect(drainEvalS1Sweep()).toHaveLength(1);
    expect(drainEvalS1Sweep()).toHaveLength(0);
  });

  it("begins clean, so an aborted sweep's leftovers cannot leak into the next", () => {
    checkpointEvalS1Results([row("stale", "m")]);
    beginEvalS1Sweep();
    expect(drainEvalS1Sweep()).toHaveLength(0);
  });

  it("is fed by EvalS1SectionTask as each section completes", () => {
    // The checkpoint is only worth anything if the section task actually writes
    // to it — the golden path emits its reference row with no model call at
    // all, so this exercises the real task rather than the sink alone.
    return (async () => {
      const task = new EvalS1SectionTask({
        defaults: {
          reference: "golden",
          candidates: [],
          dumpRaw: false,
        },
      });
      const out = await task.run({
        filing: "s1_fixture",
        extractor: "management",
        text: "ignored",
      });
      expect((out.results as unknown[]).length).toBeGreaterThan(0);
      expect(drainEvalS1Sweep()).toEqual(out.results);
    })();
  });
});
