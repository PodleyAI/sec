/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { MAX_FUZZY_MATCHES, collectPage } from "./_streamMatches";

async function* gen(count: number): AsyncGenerator<number, void, undefined> {
  for (let i = 0; i < count; i++) yield i;
}

describe("collectPage", () => {
  it("counts the FULL match set when it drains below the cap", async () => {
    // 50 matches, window is [10, 15). total must be the full count (50),
    // not offset+limit (15).
    const result = await collectPage(gen(50), 10, 5, 1000);
    expect(result.total).toBe(50);
    expect(result.exhausted).toBe(true);
    expect(result.rows).toEqual([10, 11, 12, 13, 14]);
  });

  it("reports total === maxScan and exhausted false when the cap fires", async () => {
    // 500 matches available, cap at 100. We stop counting at the cap and
    // signal that more may exist.
    const result = await collectPage(gen(500), 0, 5, 100);
    expect(result.total).toBe(100);
    expect(result.exhausted).toBe(false);
    expect(result.rows).toEqual([0, 1, 2, 3, 4]);
  });

  it("returns empty rows but the exact total when offset is past the match set", async () => {
    const result = await collectPage(gen(8), 20, 5, 1000);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(8);
    expect(result.exhausted).toBe(true);
  });

  it("handles an empty iterator: total 0, exhausted true", async () => {
    const result = await collectPage(gen(0), 0, 5, 1000);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.exhausted).toBe(true);
  });

  it("keeps the window O(limit) even when far more matches precede it", async () => {
    const result = await collectPage(gen(800), 100, 3, 1000);
    expect(result.rows).toEqual([100, 101, 102]);
    expect(result.total).toBe(800);
    expect(result.exhausted).toBe(true);
  });

  it("defaults maxScan to the shared MAX_FUZZY_MATCHES cap", async () => {
    const result = await collectPage(gen(MAX_FUZZY_MATCHES + 500), 0, 2);
    expect(result.total).toBe(MAX_FUZZY_MATCHES);
    expect(result.exhausted).toBe(false);
    expect(result.rows).toEqual([0, 1]);
  });
});
