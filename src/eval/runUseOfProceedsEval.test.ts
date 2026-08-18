/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runUseOfProceedsEval";

describe("bucketWhenParserEmpty", () => {
  it("skips when stored has no lines", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [],
        offeringText: "| Offering price | $10.00 |\n| Number of units offered | 7,500,000 |",
        sectionText: "We will use the net proceeds for working capital.",
      })
    ).toEqual({ bucket: "skip", reason: "all-null stored" });
  });

  it("empties a resale rather than missing", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ purpose: "Working capital", amount: 1_000_000 }],
        offeringText: "| Securities offered | 12,000,000 ordinary shares, at $10.00 per share |",
        sectionText: "| Held in trust account | $ | 200,000,000 |",
      }).bucket
    ).toBe("empty");
  });

  it("skips a unit-IPO with no expense table rather than missing", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ purpose: "Working capital", amount: 1_000_000 }],
        offeringText: "| Offering price | $10.00 |\n| Number of units offered | 20,000,000 |",
        sectionText: "We intend to use the net proceeds for general corporate purposes.",
      })
    ).toEqual({ bucket: "skip", reason: "no-table" });
  });

  it("misses a unit-IPO expense table the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ purpose: "Legal fees and expenses", amount: 325_000 }],
        offeringText: "| Offering price | $10.00 |\n| Number of units offered | 20,000,000 |",
        sectionText:
          "| Underwriting discounts and commissions | $ | 4,500,000 |\n| Held in trust account | $ | 300,000,000 |",
      }).bucket
    ).toBe("miss");
  });
});
