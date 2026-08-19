/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runManagementEval";

const TABLE = [
  "| Name | Age | Title |",
  "| Ally Tong Zhang | 52 | Chairwoman, Director and Chief Executive Officer |",
].join("\n");

describe("bucketWhenParserEmpty", () => {
  it("skips when stored has no lines", () => {
    expect(bucketWhenParserEmpty({ stored: [], sectionText: TABLE })).toEqual({
      bucket: "skip",
      reason: "all-null stored",
    });
  });

  it("skips when there is no roster table", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ full_name: "Jane Roe", titles: ["Director"] }],
        sectionText: "Jane Roe — Director",
      })
    ).toEqual({ bucket: "skip", reason: "no-table" });
  });

  it("misses a roster table the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ full_name: "Ally Tong Zhang", titles: ["Chief Executive Officer"] }],
        sectionText: TABLE,
      }).bucket
    ).toBe("miss");
  });
});
