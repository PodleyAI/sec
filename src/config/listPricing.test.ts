/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listPricingForModelId, SUBSTRING_PRICING_TABLES } from "./listPricing";

describe("listPricingForModelId", () => {
  it("prices Anthropic families by name", () => {
    // Sonnet 5's $2/$10 is INTRODUCTORY, not permanent — see the EXPIRES marker
    // in the source and the deadline guard at the bottom of this file. 4.x is
    // at the $3/$15 list price this reverts to.
    expect(listPricingForModelId("claude-sonnet-5")).toEqual({
      currency: "USD",
      input: 2,
      output: 10,
      cached: 0.2,
      cacheWrite: 2.5,
      cacheStoragePerHour: undefined,
    });
    expect(listPricingForModelId("claude-sonnet-4-6")?.input).toBe(3);
    expect(listPricingForModelId("claude-sonnet-4-5")?.input).toBe(3);
    expect(listPricingForModelId("claude-haiku-4-5")?.output).toBe(5);
    expect(listPricingForModelId("claude-opus-5")?.input).toBe(5);
  });

  it("prices Grok 4.6 at the published <200k rates", () => {
    expect(listPricingForModelId("grok-4.6")).toEqual({
      currency: "USD",
      input: 2,
      output: 6,
      cached: 0.5,
      cacheWrite: undefined,
      cacheStoragePerHour: undefined,
    });
  });

  it("prices Grok 4.5 at its own cache-hit rate", () => {
    expect(listPricingForModelId("grok-4.5")?.input).toBe(2);
    expect(listPricingForModelId("grok-4.5")?.cached).toBe(0.3);
  });

  it("prices the DeepSeek V4 Pro 0813 snapshot at the same cache-miss rates as pro", () => {
    expect(listPricingForModelId("deepseek-v4-pro-0813")).toEqual(
      listPricingForModelId("deepseek-v4-pro")
    );
    expect(listPricingForModelId("deepseek-v4-pro-0813")?.input).toBe(0.435);
    expect(listPricingForModelId("deepseek-v4-pro-0813")?.output).toBe(0.87);
  });

  it("treats local models as free", () => {
    expect(listPricingForModelId("onnx:org/model")?.input).toBe(0);
    expect(listPricingForModelId("gguf:Model.gguf")?.output).toBe(0);
  });

  it("leaves gateway and unknown ids unpriced", () => {
    expect(listPricingForModelId("open-router:anthropic/claude-sonnet-4")).toBeUndefined();
    expect(listPricingForModelId("hfi:meta-llama/Llama-3.3-70B-Instruct")).toBeUndefined();
    expect(listPricingForModelId("no-such-model-9000")).toBeUndefined();
  });
});

describe("substring pricing tables", () => {
  // Lookup is `id.includes(match)` in list order, so a bare id placed above the
  // dated snapshot that extends it makes the snapshot's row unreachable. That
  // costs nothing while the two price identically — and becomes a silently
  // wrong dollar figure the day one of them diverges, with nothing failing.
  // Assert reachability structurally so the trap cannot be re-armed.
  it.each(SUBSTRING_PRICING_TABLES)("every %s entry is reachable", (_name, table) => {
    const unreachable: string[] = [];
    table.forEach(([match], index) => {
      const shadowedBy = table
        .slice(0, index)
        .find(([earlier]) => match !== earlier && match.includes(earlier));
      if (shadowedBy) unreachable.push(`"${match}" is shadowed by the earlier "${shadowedBy[0]}"`);
    });
    expect(unreachable).toEqual([]);
  });
});

/**
 * A dated rate (an introductory or promotional price) is correct until its
 * stated date and wrong after it, and nothing in a running CLI notices the
 * difference — every cost figure just quietly understates spend. So the
 * `EXPIRES <YYYY-MM-DD>` markers in the source are a deadline this test
 * enforces: once the date has passed, the suite fails and names the marker.
 */
describe("EXPIRES markers", () => {
  const SOURCE_PATH = fileURLToPath(new URL("./listPricing.ts", import.meta.url));
  const EXPIRES = /EXPIRES (\d{4}-\d{2}-\d{2}):([^\n]*)/g;

  it("has not passed any dated rate's expiry", () => {
    const source = readFileSync(SOURCE_PATH, "utf8");
    const today = new Date().toISOString().slice(0, 10);
    const expired = [...source.matchAll(EXPIRES)]
      .filter(([, date]) => date < today)
      .map(([, date, note]) => `EXPIRES ${date} (today is ${today}):${note.trimEnd()}`);
    expect(expired, `expired pricing marker(s) in ${SOURCE_PATH}`).toEqual([]);
  });

  it("finds the markers it is meant to guard", () => {
    // A guard that silently matches nothing passes forever. Pin that at least
    // one marker exists and that the convention it is written in still parses.
    const source = readFileSync(SOURCE_PATH, "utf8");
    const markers = [...source.matchAll(EXPIRES)];
    expect(markers.length).toBeGreaterThan(0);
    for (const [, , note] of markers) {
      // The marker must state the replacement call, so reverting is mechanical.
      expect(note).toContain("Revert to rates(");
    }
  });
});
