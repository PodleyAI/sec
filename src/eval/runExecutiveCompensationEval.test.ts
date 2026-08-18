/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { bucketWhenParserEmpty } from "./runExecutiveCompensationEval";

describe("bucketWhenParserEmpty", () => {
  it("skips when stored has no lines", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [],
        sectionText: "Summary Compensation Table\nName and Principal Position\nSalary",
      })
    ).toEqual({ bucket: "skip", reason: "all-null stored" });
  });

  it("skips when there is no summary compensation table", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ person_name: "Alina Kowalczyk", fiscal_year: 2025, salary: 612500 }],
        sectionText: "None of our officers has received any compensation.",
      })
    ).toEqual({ bucket: "skip", reason: "no-table" });
  });

  it("misses a summary compensation table the parser should have hit", () => {
    expect(
      bucketWhenParserEmpty({
        stored: [{ person_name: "Alina Kowalczyk", fiscal_year: 2025, salary: 612500 }],
        sectionText: "Summary Compensation Table\nName and Principal Position\nSalary",
      }).bucket
    ).toBe("miss");
  });
});
