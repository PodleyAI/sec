/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runRelatedPartyEval";

const TABLE = [
  "| Convertible Note Purchasers | Original Principal Amount |",
  "| Stellantis Ventures B.V. | $5,000,000 |",
].join("\n");

describe("bucketWhenParserEmpty", () => {
  it("skips when stored has no lines", () => {
    expect(bucketWhenParserEmpty({ stored: [], sectionText: TABLE })).toEqual({
      bucket: "skip",
      reason: "all-null stored",
    });
  });

  it("skips when there is no party table", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ name: "Stellantis Ventures B.V.", party_kind: "company" }],
        sectionText: "We pay rent to an entity controlled by our CEO.",
      })
    ).toEqual({ bucket: "skip", reason: "no-table" });
  });

  it("misses a party table the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ name: "Stellantis Ventures B.V.", party_kind: "company" }],
        sectionText: TABLE,
      }).bucket
    ).toBe("miss");
  });
});
