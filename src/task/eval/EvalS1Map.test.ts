/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { EvalS1CandidateTask } from "./EvalS1CandidateTask";
import { EvalS1FilingTask } from "./EvalS1FilingTask";
import { EvalS1SectionTask } from "./EvalS1SectionTask";

function arrayPortNames(schema: { properties?: Record<string, { type?: string }> }): string[] {
  return Object.entries(schema.properties ?? {})
    .filter(([, p]) => p.type === "array")
    .map(([k]) => k);
}

describe("eval s1 map schemas", () => {
  it("does not declare array input ports that MapTask would zip", () => {
    expect(
      arrayPortNames(
        EvalS1CandidateTask.inputSchema() as { properties?: Record<string, { type?: string }> }
      )
    ).toEqual([]);
    expect(
      arrayPortNames(
        EvalS1SectionTask.inputSchema() as { properties?: Record<string, { type?: string }> }
      )
    ).toEqual([]);
  });

  it("declares the filing task's per-filing lists as arrays, which the outer map iterates", () => {
    // The opposite case, on purpose: the filing map is handed one array per
    // filing, and MapTask only iterates a port whose schema says array — a
    // scalar-typed port here would hand the whole corpus to a single iteration.
    expect(
      arrayPortNames(
        EvalS1FilingTask.inputSchema() as { properties?: Record<string, { type?: string }> }
      )
    ).toEqual(["extractors", "texts"]);
  });
});

describe("EvalS1CandidateTask", () => {
  it("records an unregistered model as a failed row without throwing", async () => {
    const task = new EvalS1CandidateTask({
      defaults: {
        filing: "s1_fixture",
        extractor: "management",
        text: "ignored",
        reference: "golden",
        refOk: true,
        dumpRaw: false,
        expected: [{ full_name: "Jane" }],
      },
    });
    const out = await task.run({ modelId: "definitely-not-registered-zzzz" });
    const row = (out.results as Array<{ ok: boolean; model: string; error?: string }>)[0];
    expect(row?.ok).toBe(false);
    expect(row?.model).toBe("definitely-not-registered-zzzz");
    expect(row?.error).toMatch(/not registered/);
  });
});
