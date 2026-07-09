/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { normalizeFamilyName } from "./FamilyResolver";

describe("normalizeFamilyName", () => {
  it("upper-cases the result so existing canonical rows stay reachable", () => {
    expect(normalizeFamilyName("Goldman Sachs")).toBe("GOLDMAN SACHS");
    expect(normalizeFamilyName("Pershing Square Sponsor")).toBe("PERSHING SQUARE SPONSOR");
  });

  it("is case-insensitive (folds upper / lower / mixed to the same key)", () => {
    const upper = normalizeFamilyName("GOLDMAN SACHS");
    const lower = normalizeFamilyName("goldman sachs");
    const mixed = normalizeFamilyName("Goldman Sachs");
    expect(upper).toBe(lower);
    expect(lower).toBe(mixed);
  });

  it("collapses internal whitespace via normalizeCompanyName", () => {
    expect(normalizeFamilyName("Goldman   Sachs")).toBe("GOLDMAN SACHS");
  });

  it("returns '' for empty / whitespace-only / null-normalized input", () => {
    expect(normalizeFamilyName("")).toBe("");
    expect(normalizeFamilyName("   ")).toBe("");
  });
});
