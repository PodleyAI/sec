/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  looksLikeUnitIpo,
  parseSpacOfferingTerms,
} from "./parseOfferingTables";

const HAPPY = `
| | |
| --- | --- |
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Proceeds to be held in trust account | $10.00 per unit |
`.trim();

describe("parseSpacOfferingTerms", () => {
  it("hits the required set on a two-column cookie-cutter table", () => {
    const row = parseSpacOfferingTerms(HAPPY);
    expect(row).not.toBeNull();
    expect(row!.source).toBe("deterministic");
    expect(row!.price_per_unit).toBe(10);
    expect(row!.units_offered).toBe(20_000_000);
    expect(row!.confidence).toBe(1);
    expect(HAPPY.includes(row!.source_span)).toBe(true);
  });

  it("takes the first value column, ignoring over-allotment", () => {
    const text = `
| | Without over-allotment | With over-allotment |
| --- | --- | --- |
| Price per unit | $10.00 | $10.00 |
| Number of units offered | 15,000,000 | 17,250,000 |
`.trim();
    expect(parseSpacOfferingTerms(text)!.units_offered).toBe(15_000_000);
  });

  it("misses when the price is outside the $8–$12 band", () => {
    const text = HAPPY.replace("$10.00", "$25.00");
    expect(parseSpacOfferingTerms(text)).toBeNull();
  });

  it("does not take units outstanding after this offering", () => {
    const text = `
| Units outstanding after this offering | 25,000,000 |
| Offering price | $10.00 |
`.trim();
    expect(parseSpacOfferingTerms(text)).toBeNull();
  });

  it("treats [●], blank, dashes as missing that field", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | [●] |
`.trim();
    expect(parseSpacOfferingTerms(text)).toBeNull();
  });

  it("first matching row wins; later tables do not overwrite", () => {
    const text = `${HAPPY}

| Offering price | $9.00 |
| Number of units offered | 1,000,000 |
`;
    expect(parseSpacOfferingTerms(text)!.price_per_unit).toBe(10);
    expect(parseSpacOfferingTerms(text)!.units_offered).toBe(20_000_000);
  });
});

describe("looksLikeUnitIpo", () => {
  it("is true when the required offering set would fill", () => {
    expect(looksLikeUnitIpo(HAPPY)).toBe(true);
  });
  it("is false on a resale-shaped table with no unit price/count", () => {
    expect(looksLikeUnitIpo("| Founder shares | 5,750,000 |")).toBe(false);
  });
});
