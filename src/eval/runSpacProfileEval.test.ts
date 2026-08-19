/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runSpacProfileEval";

const HIT =
  "Although we may pursue targets in any industry, we intend to initially focus our search on identifying a prospective target business in financial services.";

describe("bucketWhenParserEmpty", () => {
  it("skips when stored has no tags", () => {
    expect(
      bucketWhenParserEmpty({ stored: { focus: [], focus_location: [] }, sectionText: HIT })
    ).toEqual({
      bucket: "skip",
      reason: "all-null stored",
    });
  });

  it("skips when there is no identifying sentence", () => {
    expect(
      bucketWhenParserEmpty({
        stored: { focus: ["Healthcare"], focus_location: [] },
        sectionText:
          "We intend to focus our efforts on identifying a company that aligns with our team’s experiences.",
      })
    ).toEqual({ bucket: "skip", reason: "no-identification" });
  });

  it("misses an identifying sentence the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: { focus: ["Financial Services"], focus_location: [] },
        sectionText: HIT,
      }).bucket
    ).toBe("miss");
  });
});
