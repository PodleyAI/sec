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
  it("is false on a share-only securities-offered row", () => {
    const text = `
| Securities offered | 12,000,000 ordinary shares, at $10.00 per share |
`.trim();
    expect(parseSpacOfferingTerms(text)).toBeNull();
    expect(looksLikeUnitIpo(text)).toBe(false);
  });
  it("is false on a placeholder units cell with no count", () => {
    const text = `
| Securities Offered | units (or units if the underwriters’ over-allotment option is exercised in full), at $10.00 per unit |
`.trim();
    expect(parseSpacOfferingTerms(text)).toBeNull();
    expect(looksLikeUnitIpo(text)).toBe(false);
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

  it("counts a whole warrant as 1 even when the same cell states a right conversion fraction", () => {
    const row = parseSpacOfferingTerms(
      `
| Offering price | $10.00 |
| Number of units offered | 10,000,000 |
| Securities offered | each unit consisting of one ordinary share, one redeemable warrant, and one right. Each right entitles the holder thereof to receive one-fourth (1/4) of one ordinary share |
`.trim()
    )!;
    expect(row.warrant_fraction_per_unit).toBe(1);
    expect(row.right_fraction_per_unit).toBe(1);
  });

  it("reads three-quarters of one warrant, not the trailing 'one warrant'", () => {
    const row = parseSpacOfferingTerms(
      `
| Offering price | $10.00 |
| Number of units offered | 9,000,000 |
| Securities offered | 9,000,000 units, at $10.00 per unit, each unit consisting of one share of common stock and three-quarters (3/4) of one redeemable warrant |
`.trim()
    )!;
    expect(row.warrant_fraction_per_unit).toBe(0.75);
  });

  it("counts one Share Right as 1, not the tenth-of-a-share conversion", () => {
    const row = parseSpacOfferingTerms(
      `
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Securities offered | 20,000,000 units, at $10.00 per unit, each unit consisting of: one Class A ordinary share; and one Share Right to receive one tenth (1/10) of a Class A ordinary share |
`.trim()
    )!;
    expect(row.right_fraction_per_unit).toBe(1);
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

  it("reads placement warrants named in a footnote rather than the unit count", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 22,500,000 |
| Founder shares | 6,643,750 |
| Number of placement units to be sold simultaneously with this offering | 700,000 |
| (6) | Comprised of 7,500,000 public warrants included in the units to be sold in this offering and 233,333 placement warrants included in the placement units to be sold in the private placement. |
`.trim();
    expect(parseSpacPromoteTerms(text)!.private_placement_warrants).toBe(233_333);
  });

  it("skips a year in a founder-shares narrative and takes the share count", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Founder shares | In August 2020, our sponsor purchased 5,750,000 founder shares (of which 750,000 are subject to forfeiture) |
`.trim();
    expect(parseSpacPromoteTerms(text)!.founder_shares).toBe(5_750_000);
  });

  it("does not take a $25,000 purchase price as the founder share count", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Founder shares | our sponsor purchased 5,366,667 founder shares for an aggregate purchase price of $25,000 |
`.trim();
    expect(parseSpacPromoteTerms(text)!.founder_shares).toBe(5_366_667);
  });

  it("does not take an up-to forfeiture amount as the founder share count", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 35,000,000 |
| Founder shares | our sponsor paid $25,000 in consideration of 5,366,667 Class B ordinary shares and includes up to 700,000 founder shares that are subject to forfeiture |
`.trim();
    expect(parseSpacPromoteTerms(text)!.founder_shares).toBe(5_366_667);
  });

  it("takes the post-recapitalization founder share count", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 7,500,000 |
| Founder shares | In December 2025, our sponsors acquired an aggregate of 2,300,000 ordinary shares for an aggregate purchase price of $25,000. In June 2026, we effected a share capitalization to increase the number of founder shares to 2,875,000. |
`.trim();
    expect(parseSpacPromoteTerms(text)!.founder_shares).toBe(2_875_000);
  });

  it("takes the post-forfeiture remaining founder share count", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 26,100,000 |
| Founder shares | On February 2, 2026, our sponsor paid $25,000 in exchange for 10,279,000 founder shares. On May 1, 2026, the sponsor forfeited 25,000 founder shares back to us, and as a result, the Sponsor holds an aggregate of 10,254,000 founder shares. |
`.trim();
    expect(parseSpacPromoteTerms(text)!.founder_shares).toBe(10_254_000);
  });

  it("does not take a forfeiture-of amount as the founder share count", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 10,000,000 |
| Founder shares | our Sponsor purchased 4,933,500 ordinary shares for $25,000 (or approximately $0.0058 per founder share after giving effect to the forfeiture of 643,500 founder shares if the underwriters’ over-allotment option is not exercised). |
`.trim();
    expect(parseSpacPromoteTerms(text)!.founder_shares).toBe(4_933_500);
  });

  it("takes the post-surrender remaining founder share count from now-holds", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Founder shares | our sponsor paid $25,000 in exchange for 7,187,500 founder shares. On July 21, 2026, our sponsor surrendered 1,437,500 founder shares for no consideration and now holds 5,750,000 founder shares. |
`.trim();
    expect(parseSpacPromoteTerms(text)!.founder_shares).toBe(5_750_000);
  });

  it("takes the post-surrender Class B count rather than the pre-surrender purchase", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 34,500,000 |
| Founder shares | our sponsor purchased 14,375,000 Class B ordinary shares for a purchase price of $25,000. our sponsor surrendered 2,875,000 Class B ordinary shares, resulting in a decrease from 14,375,000 Class B ordinary shares to 11,500,000 Class B ordinary shares. maintain the number of founder shares at 25% of the outstanding shares |
`.trim();
    const row = parseSpacPromoteTerms(text)!;
    expect(row.founder_shares).toBe(11_500_000);
    expect(row.founder_percent).toBe(0.25);
  });

  it("takes the aggregate founder share count after an additional issuance", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 25,000,000 |
| Founder shares | our sponsor purchased 7,666,667 Class B ordinary shares. Subsequently the Company issued an additional 1,916,666 founder shares, resulting in the sponsor holding an aggregate of 9,583,333 founder shares, of which up to 1,250,000 shares are subject to forfeiture |
| Number of warrants included in the private units to be sold in a private placement simultaneously with this offering | 343,750 |
`.trim();
    const row = parseSpacPromoteTerms(text)!;
    expect(row.founder_shares).toBe(9_583_333);
    expect(row.private_placement_warrants).toBe(343_750);
  });

  it("reads private warrants from a later column when the first value cell is empty", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 10,000,000 |
| Founder shares | 2,875,000 |
| Private Warrants owned by the sponsor |  | 0 | 0 | 224,300 |
`.trim();
    expect(parseSpacPromoteTerms(text)!.private_placement_warrants).toBe(224_300);
  });

  it("reads warrants included in private units from the warrants section, not the share count", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 20,000,000 |
| Founder shares | 7,666,667 |
| Ordinary shares |  |
| Number included in the private placement units to be sold in a private placement simultaneously with this offering | 565,000 |
| Warrants: |  |
| Number included in the private placement units to be sold in a private placement simultaneously with this offering | 188,333 |
`.trim();
    expect(parseSpacPromoteTerms(text)!.private_placement_warrants).toBe(188_333);
  });

  it("takes shares outstanding before the offering when the cell says shares, not Class B", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 7,500,000 |
| Number outstanding before this offering and the private placement | 0 Units |
| Number outstanding before this offering and the private placement | 2,156,250 shares(2) |
| Number outstanding before this offering and the private placement | 0 warrants |
| Prior Issuance of Founders Shares | On August 19, 2021, our initial shareholders purchased 1,450,000 founder shares |
`.trim();
    expect(parseSpacPromoteTerms(text)!.founder_shares).toBe(2_156_250);
  });

  it("takes Class B shares outstanding before the offering over an earlier purchase price", () => {
    const text = `
| Offering price | $10.00 |
| Number of units offered | 32,500,000 |
| Number outstanding before this offering | 12,458,333 Class B ordinary shares |
| Founder shares | our sponsor purchased 11,500,000 Class B ordinary shares. the company issued an additional 958,333 Class B ordinary shares. founder shares at approximately 25% of the outstanding shares |
`.trim();
    const row = parseSpacPromoteTerms(text)!;
    expect(row.founder_shares).toBe(12_458_333);
    expect(row.founder_percent).toBe(0.25);
  });
});

describe("nested offering table cells", () => {
  it("reads units-at-price and a following warrant bullet", () => {
    const text = `
| Number of units | 20,000,000 units, at $10.00 per unit, each unit consisting of: |
|  | • one share of Class A common stock |
|  | • one-half of one redeemable warrant. |
`.trim();
    const row = parseSpacOfferingTerms(text)!;
    expect(row.units_offered).toBe(20_000_000);
    expect(row.price_per_unit).toBe(10);
    expect(row.warrant_fraction_per_unit).toBe(0.5);
  });

  it("reads a warrant fraction from a bullet-glyph first cell", () => {
    const text = `
| Securities offered | 35,000,000 units, at $10.00 per unit, each unit consisting of: |
| • | one-fourth of one redeemable warrant. |
`.trim();
    const row = parseSpacOfferingTerms(text)!;
    expect(row.units_offered).toBe(35_000_000);
    expect(row.price_per_unit).toBe(10);
    expect(row.warrant_fraction_per_unit).toBe(0.25);
  });

  it("reads rights and warrants from a three-column bullet column", () => {
    const text = `
| Securities offered | 7,500,000 units, at $10.00 per unit, each unit consisting of: |
|  | ● | one right; and |
|  | ● | one-half of one warrant. |
`.trim();
    const row = parseSpacOfferingTerms(text)!;
    expect(row.right_fraction_per_unit).toBe(1);
    expect(row.warrant_fraction_per_unit).toBe(0.5);
  });

  it("reads composition from a four-column nested bullet column", () => {
    const text = `
| Securities offered | 10,000,000 units at $10.00 per unit, each unit consisting of: |
|  |  | ● | One ordinary share, and |
|  |  | ● | One right to receive one-fourth (1/4) of one ordinary share |
|  |  | ● | One redeemable warrant with each whole warrant exercisable to purchase one ordinary share |
`.trim();
    const row = parseSpacOfferingTerms(text)!;
    expect(row.right_fraction_per_unit).toBe(1);
    expect(row.warrant_fraction_per_unit).toBe(1);
  });

  it("reads units-at-price when an over-allotment parenthetical sits between units and at", () => {
    const text = `
| Securities offered | 20,000,000 units (or 23,000,000 units if the underwriter’s over-allotment option is exercised in full), at $10.00 per unit, each unit consisting of: |
|  |  | ● | one-third (1/3) of one warrant to purchase one Class A ordinary share |
`.trim();
    const row = parseSpacOfferingTerms(text)!;
    expect(row.units_offered).toBe(20_000_000);
    expect(row.price_per_unit).toBe(10);
    expect(row.warrant_fraction_per_unit).toBe(0.3333);
  });

  it("reads units-at-price when the cell says at a price of $10 per unit", () => {
    const text = `
| Securities offered | 15,000,000 units (or 17,250,000 units if the underwriters’ over-allotment option is exercised in full), at a price of $10.00 per unit, each unit consisting of: |
|  | • one-half of one redeemable warrant. |
`.trim();
    const row = parseSpacOfferingTerms(text)!;
    expect(row.units_offered).toBe(15_000_000);
    expect(row.price_per_unit).toBe(10);
    expect(row.warrant_fraction_per_unit).toBe(0.5);
  });

  it("skips an empty spacer value column before the units-at-price cell", () => {
    const text = `
| Securities offered |  | 20,000,000 units (or 23,000,000 units if the underwriters’ over-allotment option is exercised in full), at $10.00 per unit, each unit consisting of: |
`.trim();
    const row = parseSpacOfferingTerms(text)!;
    expect(row.units_offered).toBe(20_000_000);
    expect(row.price_per_unit).toBe(10);
  });
});
