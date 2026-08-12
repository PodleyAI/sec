/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  EVAL_S1_CONCURRENCY_DEFAULT,
  resolveEvalS1Concurrency,
} from "./evalS1Concurrency";

describe("resolveEvalS1Concurrency", () => {
  it("defaults to 5 when omitted", () => {
    expect(EVAL_S1_CONCURRENCY_DEFAULT).toBe(5);
    expect(resolveEvalS1Concurrency(undefined)).toBe(5);
  });

  it("returns a positive integer override", () => {
    expect(resolveEvalS1Concurrency(1)).toBe(1);
    expect(resolveEvalS1Concurrency(8)).toBe(8);
  });

  it("rejects 0 and negatives", () => {
    expect(() => resolveEvalS1Concurrency(0)).toThrow(/>= 1/);
    expect(() => resolveEvalS1Concurrency(-1)).toThrow(/>= 1/);
  });
});
