/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { parseNumeric } from "./parseNumeric";

describe("parseNumeric", () => {
  it("parses plain and grouped integers", () => {
    expect(parseNumeric("1234")).toBe(1234);
    expect(parseNumeric("1,234,567")).toBe(1234567);
  });
  it("parses currency and percent", () => {
    expect(parseNumeric("$1,250.50")).toBe(1250.5);
    expect(parseNumeric("12.5%")).toBe(12.5);
  });
  it("treats parentheses as negative", () => {
    expect(parseNumeric("(2,000)")).toBe(-2000);
    expect(parseNumeric("$(15.00)")).toBe(-15);
  });
  it("returns undefined for non-numeric / dashes", () => {
    expect(parseNumeric("—")).toBeUndefined();
    expect(parseNumeric("n/a")).toBeUndefined();
    expect(parseNumeric("")).toBeUndefined();
    expect(parseNumeric("see note 3")).toBeUndefined();
  });
});
