/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runUnderwritersEval";

describe("bucketWhenParserEmpty", () => {
  const unitIpo = "| Offering price | $10.00 |\n| Number of units offered | 20,000,000 |";

  it("skips when stored has no underwriter names", () => {
    expect(
      bucketWhenParserEmpty({
        stored: { names: [], roles: [] },
        offeringText: unitIpo,
        underwritingText: "| Underwriter | Number of Units |\n| Cantor Fitzgerald & Co. | |",
      })
    ).toEqual({ bucket: "skip", reason: "all-null stored" });
  });

  it("empties a resale rather than missing", () => {
    expect(
      bucketWhenParserEmpty({
        stored: { names: ["Acme Holdings LLC"], roles: [null] },
        offeringText: "| Securities offered | 12,000,000 ordinary shares, at $10.00 per share |",
        underwritingText: "| Selling Stockholder | Shares |\n| Acme Holdings LLC | 1 |",
      }).bucket
    ).toBe("empty");
  });

  it("skips a unit-IPO whose syndicate is named only in prose", () => {
    expect(
      bucketWhenParserEmpty({
        stored: { names: ["Needham & Company, LLC"], roles: ["lead"] },
        offeringText: unitIpo,
        underwritingText: "Needham & Company, LLC is acting as the sole underwriter of this offering.",
      })
    ).toEqual({ bucket: "skip", reason: "no-table" });
  });

  it("misses a unit-IPO syndicate table the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: { names: ["Cantor Fitzgerald & Co."], roles: ["lead"] },
        offeringText: unitIpo,
        underwritingText:
          "| Underwriter | Number of Units |\n| --- | --- |\n| Cantor Fitzgerald & Co. | |\n| Total | 20,000,000 |",
      }).bucket
    ).toBe("miss");
  });
});
