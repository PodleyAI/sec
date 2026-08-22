/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runBeneficialOwnershipEval";

const TABLE = [
  "| Name and Address of Beneficial Owner | Number of Shares Beneficially Owned | Percent |",
  "| Halyard Sponsor III LLC | 4,312,500 | 100.0% |",
].join("\n");

describe("bucketWhenParserEmpty", () => {
  it("skips when stored has no lines", () => {
    expect(bucketWhenParserEmpty({ stored: [], sectionText: TABLE })).toEqual({
      bucket: "skip",
      reason: "all-null stored",
    });
  });

  it("skips when there is no ownership table", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ name: "Halyard Sponsor III LLC", owner_kind: "company", shares_owned: 4312500 }],
        sectionText: "Our sponsor owns founder shares.",
      })
    ).toEqual({ bucket: "skip", reason: "no-table" });
  });

  it("misses an ownership table the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ name: "Halyard Sponsor III LLC", owner_kind: "company", shares_owned: 4312500 }],
        sectionText: TABLE,
      }).bucket
    ).toBe("miss");
  });
});
