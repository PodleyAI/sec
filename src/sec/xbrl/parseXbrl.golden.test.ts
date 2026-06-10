/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { parseInlineXbrl } from "./parseInlineXbrl";
import { extractXbrlCoverPage } from "./coverPage";

const FIXTURES = join(import.meta.dir, "../html/mock_data/s1");

function load(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("parseInlineXbrl golden: Churchill Capital Corp XII S-1 (full SPAC tagging)", () => {
  const result = parseInlineXbrl(load("s1_2114227_000121390026039320.htm"));

  it("finds the full fact/context/unit population", () => {
    expect(result.hasXbrl).toBe(true);
    expect(result.facts.length).toBe(260); // 216 nonFraction + 44 nonNumeric
    expect(result.facts.filter((f) => f.isNumeric).length).toBe(216);
    expect(result.contexts.size).toBe(141);
    expect(result.units.size).toBe(4);
  });

  it("extracts the dei cover page", () => {
    const cover = extractXbrlCoverPage(result);
    expect(cover.documentType).toBe("S-1");
    expect(cover.registrantName).toBe("Churchill Capital Corp XII");
    expect(cover.centralIndexKey).toBe(2114227);
    expect(cover.incorporationStateCountryCode).toBe("Cayman Islands");
    expect(cover.emergingGrowthCompany).toBe(true);
    expect(cover.exTransitionPeriod).toBe(false);
  });

  it("parses spac-taxonomy numeric facts with units and contexts that resolve", () => {
    const numeric = result.facts.filter((f) => f.isNumeric && f.concept.startsWith("spac:"));
    expect(numeric.length).toBeGreaterThan(100);
    for (const fact of numeric) {
      expect(fact.contextRef).not.toBeNull();
      expect(result.contexts.has(fact.contextRef!)).toBe(true);
      expect(fact.unitRef).not.toBeNull();
      expect(result.units.has(fact.unitRef!)).toBe(true);
    }
    // num-dot-decimal is registered, so every non-nil numeric fact must resolve.
    const unresolved = numeric.filter((f) => !f.isNil && f.numericValue === null);
    expect(unresolved).toHaveLength(0);
  });

  it("applies sign to negative facts", () => {
    const negatives = result.facts.filter((f) => f.sign === "-");
    expect(negatives.length).toBeGreaterThan(0);
    for (const fact of negatives) {
      expect(fact.numericValue === null || fact.numericValue <= 0).toBe(true);
    }
  });

  it("captures dimensional qualifiers on contexts", () => {
    const dimensional = [...result.contexts.values()].filter((c) => c.dimensions.length > 0);
    expect(dimensional.length).toBeGreaterThan(0);
  });
});

describe("parseInlineXbrl golden: Texas Precious Metals Trust S-1 (cover-page-only tagging)", () => {
  const result = parseInlineXbrl(load("s1_2087989_000143774926019444.htm"));

  it("finds the cover-page facts", () => {
    expect(result.hasXbrl).toBe(true);
    expect(result.facts.length).toBe(19);
    expect(result.facts.every((f) => !f.isNumeric)).toBe(true);
    expect(result.contexts.size).toBe(1);
  });

  it("extracts the dei cover page including ballot-box booleans", () => {
    const cover = extractXbrlCoverPage(result);
    expect(cover.registrantName).toBe("Texas Precious Metals Trust");
    expect(cover.centralIndexKey).toBe(2087989);
    expect(cover.documentType).toBe("S-1/A");
    expect(cover.addressLine1).not.toBeNull();
    expect(cover.city).not.toBeNull();
    expect(cover.cityAreaCode).not.toBeNull();
    expect(cover.localPhoneNumber).not.toBeNull();
    expect(cover.emergingGrowthCompany).not.toBeNull();
  });
});

describe("parseInlineXbrl golden: untagged S-1 (2021 vintage)", () => {
  it("reports hasXbrl=false", () => {
    const result = parseInlineXbrl(load("s1_1848507_000119312521066104.htm"));
    expect(result.hasXbrl).toBe(false);
    expect(result.facts).toHaveLength(0);
  });
});
