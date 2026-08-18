/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserNull } from "./runOfferingTablesEval";

describe("bucketWhenParserNull", () => {
  it("skips an all-null stored offering row", () => {
    expect(
      bucketWhenParserNull({
        kind: "offering",
        stored: { price_per_unit: null, warrant_fraction_per_unit: null },
        text: "| Nasdaq symbols | Units: “XXXXU” |",
      })
    ).toEqual({ bucket: "skip", reason: "all-null stored" });
  });

  it("empties a share-only IPO rather than missing", () => {
    expect(
      bucketWhenParserNull({
        kind: "offering",
        stored: { price_per_unit: 10, warrant_fraction_per_unit: null },
        text: "| Securities offered | 12,000,000 ordinary shares, at $10.00 per share |",
      }).bucket
    ).toBe("empty");
  });

  it("empties a follow-on priced outside the unit-IPO band", () => {
    expect(
      bucketWhenParserNull({
        kind: "offering",
        stored: { price_per_unit: 0.78, warrant_fraction_per_unit: null },
        text: "| Securities offered | 5,937,100 Units, at $0.7832 per unit |",
      }).bucket
    ).toBe("empty");
  });

  it("skips an all-null stored promote row", () => {
    expect(
      bucketWhenParserNull({
        kind: "promote",
        stored: { founder_shares: null, trust_per_public_share: null },
        text: "| Offering price | $10.00 |\n| Number of units offered | 7,500,000 |",
      })
    ).toEqual({ bucket: "skip", reason: "all-null stored" });
  });

  it("misses a unit-IPO offering table the parser should have hit", () => {
    expect(
      bucketWhenParserNull({
        kind: "offering",
        stored: { price_per_unit: 10, warrant_fraction_per_unit: 0.5 },
        text: "| Securities offered | 7,500,000 units, at $10.00 per unit |",
      }).bucket
    ).toBe("miss");
  });
});
