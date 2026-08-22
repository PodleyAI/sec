/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runSpacSponsorsEval";

const HIT =
  "Our sponsor, Bluerock Acquisition Holdings II, LLC, is a Delaware limited liability company.";

describe("bucketWhenParserEmpty", () => {
  it("skips when stored has no lines", () => {
    expect(bucketWhenParserEmpty({ stored: [], sectionText: HIT })).toEqual({
      bucket: "skip",
      reason: "all-null stored",
    });
  });

  it("skips when there is no identifying sentence", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ legal_name: "Acme Sponsor LLC" }],
        sectionText: "Our sponsor, officers or directors may purchase shares.",
      })
    ).toEqual({ bucket: "skip", reason: "no-identification" });
  });

  it("misses an identifying sentence the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ legal_name: "Bluerock Acquisition Holdings II, LLC" }],
        sectionText: HIT,
      }).bucket
    ).toBe("miss");
  });
});
