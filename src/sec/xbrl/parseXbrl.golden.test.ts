/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
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

describe("parseInlineXbrl golden: Churchill Capital Corp XII EX-FILING FEES exhibit", () => {
  const result = parseInlineXbrl(
    readFileSync(join(import.meta.dir, "mock_data/exfee_2114227_000121390026039320.htm"), "utf8")
  );

  it("parses the ffd-taxonomy fee table", () => {
    expect(result.hasXbrl).toBe(true);
    expect(result.facts.length).toBe(53);
    expect(result.facts.filter((f) => f.isNumeric).length).toBe(25);
    expect(result.contexts.size).toBe(5);
    // The submission-level metadata facts live in ix:hidden.
    expect(result.facts.filter((f) => f.isHidden).length).toBe(6);
  });

  it("recovers the registered offering size and fee", () => {
    const byConcept = (c: string) => result.facts.filter((f) => f.concept === c);
    expect(byConcept("ffd:TtlOfferingAmt")[0].numericValue).toBe(384675000);
    expect(byConcept("ffd:NetFeeAmt")[0].numericValue).toBe(53123.62);
    expect(byConcept("ffd:FeeRate")[0].numericValue).toBe(0.0001381);
    // Per-class rows: units, shares, warrants.
    expect(byConcept("ffd:AmtSctiesRegd").map((f) => f.numericValue)).toEqual([
      34500000, 34500000, 3450000, 3450000,
    ]);
    const registrant = result.facts.find((f) => f.concept === "dei:EntityRegistrantName")!;
    expect(registrant.value).toBe("Churchill Capital Corp XII");
  });
});

describe("parseInlineXbrl golden: JPMorgan 424B2 EX-FILING FEES exhibit (pay-as-you-go)", () => {
  const result = parseInlineXbrl(
    readFileSync(join(import.meta.dir, "mock_data/exfee_19617_000183988226028863.htm"), "utf8")
  );

  it("parses the narrative-format takedown fee disclosure", () => {
    expect(result.hasXbrl).toBe(true);
    expect(result.facts.length).toBe(12);
    const byConcept = (c: string) => result.facts.find((f) => f.concept === c)!;
    expect(byConcept("dei:EntityRegistrantName").value).toBe("JPMorgan Chase & Co.");
    // Rule 456(b) narrative disclosure: the takedown amount, the final-prospectus
    // flag, and the registration file number tying the 424B2 to its S-3.
    expect(byConcept("ffd:NrrtvMaxAggtOfferingPric").numericValue).toBe(689000);
    expect(byConcept("ffd:FnlPrspctsFlg").value).toBe("true");
    expect(byConcept("ffd:RegnFileNb").value).toBe("333-293684");
    expect(byConcept("ffd:FormTp").value).toBe("S-3");
  });
});

describe("parseInlineXbrl golden: untagged S-1 (2021 vintage)", () => {
  it("reports hasXbrl=false", () => {
    const result = parseInlineXbrl(load("s1_1848507_000119312521066104.htm"));
    expect(result.hasXbrl).toBe(false);
    expect(result.facts).toHaveLength(0);
  });
});
