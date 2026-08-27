/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseEdgarHtml } from "../../../html/parseEdgarHtml";
import { hasSummaryCompensationTable } from "./compensationHeuristic";
import { S1_SECTIONS } from "../../../html/sectionVocabulary";
import { DocumentTreeSegmenter } from "./DocumentTreeSegmenter";

const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");
const fixtureDir = join(importMetaDir, "..", "..", "..", "html", "mock_data", "s1");

function compensationSection(file: string): string | undefined {
  const doc = parseEdgarHtml(readFileSync(join(fixtureDir, file), "utf8"), file);
  return new DocumentTreeSegmenter()
    .segment(doc)
    .find((s) => s.name === S1_SECTIONS.EXECUTIVE_COMPENSATION)?.text;
}

describe("hasSummaryCompensationTable", () => {
  it("is false for a missing or blank section", () => {
    expect(hasSummaryCompensationTable(undefined)).toBe(false);
    expect(hasSummaryCompensationTable("   ")).toBe(false);
  });

  it("requires the salary caption, not merely salary prose", () => {
    expect(
      hasSummaryCompensationTable(
        "Each executive's base salary is reviewed annually by our compensation committee."
      )
    ).toBe(false);
  });

  it("requires a table identifier alongside the salary caption", () => {
    expect(hasSummaryCompensationTable("Salary and benefits are set by the board.")).toBe(false);
    expect(hasSummaryCompensationTable("Summary Compensation Table\n\n| Name | Salary ($) |")).toBe(
      true
    );
    expect(hasSummaryCompensationTable("| Name and Principal Position | Salary ($) |")).toBe(true);
  });
});

describe("hasSummaryCompensationTable over real filings", () => {
  it("accepts an operating company's compensation section", () => {
    const text = compensationSection("s1_1507957_000143774926010088.htm");
    expect(text).toBeDefined();
    expect(hasSummaryCompensationTable(text)).toBe(true);
  });

  it("rejects a blank-check company's no-compensation section", () => {
    // The SPAC's section is one sentence stating that no officer or director has
    // received any compensation — there is no table to extract, so the AI pass
    // must be skipped rather than dead-lettered forever as MODEL_EMPTY.
    const text = compensationSection("s1_1848507_000119312521066104.htm");
    expect(text).toBeDefined();
    expect(hasSummaryCompensationTable(text)).toBe(false);
  });
});
