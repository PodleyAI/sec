/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runSpacClassificationEval";

const HIT =
  "Acme Acquisition Corp. is a newly organized blank check company formed for the purpose of effecting a merger with one or more businesses.";

describe("bucketWhenParserEmpty", () => {
  it("skips when stored is not a SPAC", () => {
    expect(bucketWhenParserEmpty({ stored: { is_spac: false }, sectionText: HIT })).toEqual({
      bucket: "skip",
      reason: "all-null stored",
    });
  });

  it("skips when there is no formation pair", () => {
    expect(
      bucketWhenParserEmpty({
        stored: { is_spac: true },
        sectionText: "We develop industrial batteries.",
      })
    ).toEqual({ bucket: "skip", reason: "no-identification" });
  });

  it("misses a formation pair the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: { is_spac: true },
        sectionText: HIT,
      }).bucket
    ).toBe("miss");
  });
});
