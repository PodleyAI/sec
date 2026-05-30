/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { numScalar, numWrapped, strScalar, strWrapped } from "./_valueHelpers";

describe("strScalar", () => {
  it("returns null for undefined/null/empty/whitespace", () => {
    expect(strScalar(undefined)).toBeNull();
    expect(strScalar(null)).toBeNull();
    expect(strScalar("")).toBeNull();
    expect(strScalar("  ")).toBeNull();
    expect(strScalar("\t\n")).toBeNull();
  });
  it("trims and returns a non-empty string", () => {
    expect(strScalar("abc")).toBe("abc");
    expect(strScalar("  42  ")).toBe("42");
    expect(strScalar("0")).toBe("0");
    expect(strScalar(0)).toBe("0");
  });
});

describe("numScalar", () => {
  it("returns null for undefined/null/empty/whitespace", () => {
    expect(numScalar(undefined)).toBeNull();
    expect(numScalar(null)).toBeNull();
    expect(numScalar("")).toBeNull();
    expect(numScalar("  ")).toBeNull();
    expect(numScalar("\t\n")).toBeNull();
  });
  it("coerces trimmed numeric strings", () => {
    expect(numScalar("0")).toBe(0);
    expect(numScalar("  42  ")).toBe(42);
    expect(numScalar("3.14")).toBe(3.14);
  });
  it("returns null for non-numeric input", () => {
    expect(numScalar("abc")).toBeNull();
  });
  it("passes through finite numbers and rejects non-finite", () => {
    expect(numScalar(7)).toBe(7);
    expect(numScalar(Number.NaN)).toBeNull();
    expect(numScalar(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("strWrapped", () => {
  it("returns null for undefined/null/empty/whitespace", () => {
    expect(strWrapped(undefined)).toBeNull();
    expect(strWrapped(null)).toBeNull();
    expect(strWrapped("")).toBeNull();
    expect(strWrapped("  ")).toBeNull();
    expect(strWrapped("\t\n")).toBeNull();
  });
  it("unwraps {value} leaves with the same semantics", () => {
    expect(strWrapped({ value: "abc" })).toBe("abc");
    expect(strWrapped({ value: "  42  " })).toBe("42");
    expect(strWrapped({ value: "0" })).toBe("0");
    expect(strWrapped({ value: "  " })).toBeNull();
    expect(strWrapped({ value: undefined })).toBeNull();
    expect(strWrapped({})).toBeNull();
  });
  it("accepts a bare string value", () => {
    expect(strWrapped("abc")).toBe("abc");
  });
});

describe("numWrapped", () => {
  it("returns null for undefined/null and bare strings", () => {
    expect(numWrapped(undefined)).toBeNull();
    expect(numWrapped(null)).toBeNull();
    // Bare string is a schema mismatch at a wrapped call site.
    expect(numWrapped("42")).toBeNull();
    expect(numWrapped("")).toBeNull();
    expect(numWrapped("  ")).toBeNull();
  });
  it("unwraps {value} leaves and coerces with finite check", () => {
    expect(numWrapped({ value: "0" })).toBe(0);
    expect(numWrapped({ value: "  42  " })).toBe(42);
    expect(numWrapped({ value: "3.14" })).toBe(3.14);
    expect(numWrapped({ value: "abc" })).toBeNull();
    expect(numWrapped({ value: "" })).toBeNull();
    expect(numWrapped({ value: "  " })).toBeNull();
    expect(numWrapped({ value: "\t\n" })).toBeNull();
    expect(numWrapped({ value: undefined })).toBeNull();
    expect(numWrapped({})).toBeNull();
  });
});
