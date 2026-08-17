/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  looksLikeUnitIpo,
  parseSpacOfferingTerms,
  parseSpacPromoteTerms,
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

describe("parseSpacOfferingTerms optional fields", () => {
  it("reads one-half warrant and ignores a $300M trust total", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 30,000,000 |
| Securities offered | 30,000,000 units, each consisting of one share and one-half of one warrant |
| Proceeds to be held in trust account | $300,000,000 |
`.trim();
    const row = parseSpacOfferingTerms(text)!;
    expect(row.warrant_fraction_per_unit).toBe(0.5);
    expect(row.unit_composition).toMatch(/consisting of/i);
    expect(row.trust_per_unit).toBeNull();
  });

  it("reads trust per unit from a $10.00 per unit cell", () => {
    const row = parseSpacOfferingTerms(
      `
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Proceeds to be held in trust account | $10.00 per unit |
`.trim()
    )!;
    expect(row.trust_per_unit).toBe(10);
  });

  it("counts rights in the unit as 1, not the share-conversion fraction", () => {
    const row = parseSpacOfferingTerms(
      `
| Offering price | $10.00 |
| Number of units offered | 10,000,000 |
| Securities offered | units, each consisting of one share and one right to receive one-fourth of one share |
`.trim()
    )!;
    expect(row.right_fraction_per_unit).toBe(1);
  });

  it("stores one-third as 0.3333", () => {
    const row = parseSpacOfferingTerms(
      `
| Offering price | $10.00 |
| Number of units offered | 10,000,000 |
| Securities offered | each unit consisting of one share and one-third of one warrant |
`.trim()
    )!;
    expect(row.warrant_fraction_per_unit).toBe(0.3333);
  });
});

const PROMOTE = `
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Founder shares | 5,750,000 (of which 750,000 are subject to forfeiture) |
| Founder shares | 20% |
| Private placement warrants | 6,000,000 |
| Proceeds to be held in trust account | $10.00 per public share |
`.trim();

describe("parseSpacPromoteTerms", () => {
  it("takes gross founder shares before the forfeiture clause", () => {
    const row = parseSpacPromoteTerms(PROMOTE)!;
    expect(row.source).toBe("deterministic");
    expect(row.founder_shares).toBe(5_750_000);
    expect(row.founder_percent).toBe(0.2);
    expect(row.private_placement_warrants).toBe(6_000_000);
    expect(row.trust_per_public_share).toBe(10);
  });

  it("rejects a promote-looking table that is not a unit IPO (resale guard)", () => {
    const text = `
| Founder shares | 14,300,000 |
| Private placement warrants | 6,800,000 |
`.trim();
    expect(parseSpacPromoteTerms(text)).toBeNull();
    expect(looksLikeUnitIpo(text)).toBe(false);
  });

  it("does not invent private warrants from private units", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Founder shares | 5,000,000 |
| Private placement units | 400,000 |
`.trim();
    expect(parseSpacPromoteTerms(text)!.private_placement_warrants).toBeNull();
  });
});
