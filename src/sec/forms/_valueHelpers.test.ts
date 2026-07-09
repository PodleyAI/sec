/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { numScalar, numWrapped, strScalar, strWrapped } from "./_valueHelpers";

describe("strScalar", () => {
  it("returns null for undefined", () => {
    expect(strScalar(undefined)).toBe(null);
  });
  it("returns null for null", () => {
    expect(strScalar(null)).toBe(null);
  });
  it("returns null for empty string", () => {
    expect(strScalar("")).toBe(null);
  });
  it("returns null for whitespace-only string", () => {
    expect(strScalar("   ")).toBe(null);
  });
  it("trims surrounding whitespace", () => {
    expect(strScalar("  hi  ")).toBe("hi");
  });
  it("preserves non-empty values", () => {
    expect(strScalar("hi")).toBe("hi");
  });
});

describe("numScalar", () => {
  it("returns null for undefined", () => {
    expect(numScalar(undefined)).toBe(null);
  });
  it("returns null for null", () => {
    expect(numScalar(null)).toBe(null);
  });
  it("returns null for empty string", () => {
    expect(numScalar("")).toBe(null);
  });
  it("returns null for whitespace-only string", () => {
    expect(numScalar("  ")).toBe(null);
  });
  it("returns 0 for the literal string '0' (regression guard)", () => {
    // The bug we are guarding against is exactly that "0" used to be
    // indistinguishable from `""` after Value.Convert, both becoming 0;
    // legitimate "0" must still survive.
    expect(numScalar("0")).toBe(0);
  });
  it("parses negative decimals", () => {
    expect(numScalar("-1.5")).toBe(-1.5);
  });
  it("returns null for 'NaN'", () => {
    expect(numScalar("NaN")).toBe(null);
  });
  it("returns null for 'Infinity'", () => {
    // Number("Infinity") is finite-typed but Number.isFinite returns
    // false; we coerce that to null so a downstream `> 0` check doesn't
    // see an Infinity row.
    expect(numScalar("Infinity")).toBe(null);
  });
  it("returns null for thousand-separator strings (Number rejects them)", () => {
    // "1,000.50" is Number-rejected (NaN). We choose to drop rather
    // than guess a locale; callers that want comma-handling must
    // pre-clean.
    expect(numScalar("1,000.50")).toBe(null);
  });
  it("parses ordinary integers", () => {
    expect(numScalar("42")).toBe(42);
  });
  it("parses very large but finite doubles", () => {
    expect(numScalar("1e308")).toBe(1e308);
  });
  it("returns null for 1e309 (overflows to Infinity)", () => {
    expect(numScalar("1e309")).toBe(null);
  });
  it("accepts already-numeric inputs", () => {
    expect(numScalar(42)).toBe(42);
    expect(numScalar(0)).toBe(0);
  });
});

describe("strWrapped", () => {
  it("returns null for undefined wrapper", () => {
    expect(strWrapped(undefined)).toBe(null);
  });
  it("returns null for null wrapper", () => {
    expect(strWrapped(null)).toBe(null);
  });
  it("returns null when .value is empty", () => {
    expect(strWrapped({ value: "" })).toBe(null);
  });
  it("returns null when .value is whitespace-only", () => {
    expect(strWrapped({ value: "  " })).toBe(null);
  });
  it("unwraps and trims a non-empty .value", () => {
    expect(strWrapped({ value: "  hi  " })).toBe("hi");
  });
  it("returns null for a wrapper with no .value", () => {
    expect(strWrapped({})).toBe(null);
    expect(strWrapped({ value: undefined })).toBe(null);
  });
  // Bare-string call sites: the Ownership Document passes untagged leaves
  // (e.g. documentType, issuerName) straight through, so the wrapped form
  // must trim-or-null a plain string rather than null it out.
  it("accepts and trims a bare string", () => {
    expect(strWrapped("  hi  ")).toBe("hi");
    expect(strWrapped("")).toBe(null);
    expect(strWrapped("   ")).toBe(null);
  });
});

describe("numWrapped", () => {
  it("returns null for undefined wrapper", () => {
    expect(numWrapped(undefined)).toBe(null);
  });
  it("returns null for null wrapper", () => {
    expect(numWrapped(null)).toBe(null);
  });
  it("returns null when .value is empty", () => {
    expect(numWrapped({ value: "" })).toBe(null);
  });
  it("returns null when .value is whitespace-only", () => {
    expect(numWrapped({ value: "   " })).toBe(null);
  });
  it("returns 0 for .value === '0'", () => {
    expect(numWrapped({ value: "0" })).toBe(0);
  });
  it("parses .value === '-1.5'", () => {
    expect(numWrapped({ value: "-1.5" })).toBe(-1.5);
  });
  it("returns null for .value === 'NaN'", () => {
    expect(numWrapped({ value: "NaN" })).toBe(null);
  });
  it("returns null for .value === '1e309'", () => {
    expect(numWrapped({ value: "1e309" })).toBe(null);
  });
  it("returns null for a wrapper with no .value", () => {
    expect(numWrapped({})).toBe(null);
    expect(numWrapped({ value: undefined })).toBe(null);
  });
  // A bare string at a wrapped numeric call site is a schema mismatch and
  // is refused rather than coerced.
  it("refuses a bare string", () => {
    expect(numWrapped("42")).toBe(null);
    expect(numWrapped("")).toBe(null);
  });
});
