/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  cleanCell,
  collapseRow,
  isSeparatorRow,
  mergeHeaderRows,
  splitGfmTables,
  splitPipeRow,
} from "./gfmTables";
import { parseBeneficialOwnership } from "./parseBeneficialOwnership";
import { parseManagementRoster } from "./parseManagementRoster";

describe("splitPipeRow", () => {
  it("splits a plain row", () => {
    expect(splitPipeRow("| a | b | c |")).toEqual([" a ", " b ", " c "]);
  });

  it("returns cells verbatim, leaving whitespace to cleanCell", () => {
    // Six of the seven private copies did not trim, and every caller that
    // cares runs cleanCell. Trimming here would silently change the seventh.
    expect(splitPipeRow("|  padded  |")).toEqual(["  padded  "]);
  });

  it("keeps an escaped pipe inside its own cell", () => {
    // The divergence this module exists to end: `end.split(\"|\")` yielded FOUR
    // cells here, shifting every value right of the escape into the wrong
    // column — so the same rendered table parsed differently depending on
    // which walk read it.
    expect(splitPipeRow("| Class A \\| Class B | 1,000 | 5% |")).toEqual([
      " Class A | Class B ",
      " 1,000 ",
      " 5% ",
    ]);
  });

  it("handles a row with no delimiters at all", () => {
    expect(splitPipeRow("bare")).toEqual(["bare"]);
  });
});

describe("isSeparatorRow", () => {
  it("recognizes the rule under a header, in either alignment form", () => {
    expect(isSeparatorRow("| --- | --- |")).toBe(true);
    expect(isSeparatorRow("|:---|---:|")).toBe(true);
    expect(isSeparatorRow("| Name | Shares |")).toBe(false);
  });
});

describe("cleanCell", () => {
  it("folds zero-width and non-breaking spaces to a space rather than deleting them", () => {
    // Filer agents use them as spacing; deleting joins two words into one.
    expect(cleanCell("Jane Doe")).toBe("Jane Doe");
    expect(cleanCell("A​B")).toBe("A B");
    expect(cleanCell("  lots   of   space  ")).toBe("lots of space");
  });
});

describe("splitGfmTables", () => {
  it("groups consecutive pipe lines, dropping separators, and ends a table on prose", () => {
    const text = [
      "Some prose.",
      "| Name | Shares |",
      "| --- | --- |",
      "| Jane Doe | 1,000 |",
      "",
      "More prose.",
      "| Other | Table |",
      "| x | y |",
    ].join("\n");
    expect(splitGfmTables(text)).toEqual([
      [
        ["Name", "Shares"],
        ["Jane Doe", "1,000"],
      ],
      [
        ["Other", "Table"],
        ["x", "y"],
      ],
    ]);
  });
});

describe("collapseRow", () => {
  it("drops empty cells and immediate repeats", () => {
    // Spacer columns carry the `$`; a colspan caption repeats across its span.
    expect(collapseRow(["Total", "", "Total", "$", "1,000"])).toEqual(["Total", "$", "1,000"]);
  });
});

describe("mergeHeaderRows", () => {
  it("folds a two-line header into one caption per column", () => {
    expect(mergeHeaderRows(["Name", "Shares", ""], ["", "Owned", "Percent"])).toEqual([
      "Name",
      "Shares Owned",
      "Percent",
    ]);
  });
});

describe("the parsers agree on one table grammar", () => {
  // Before extraction, four parsers used `end.split("|")` and three a scan that
  // honoured `\|`. This is the case that told them apart.
  const ESCAPED = [
    "| Name | Class A \\| Class B | Percent |",
    "| --- | --- | --- |",
    "| Jane Doe | 1,000 | 5% |",
  ].join("\n");

  it("reads an escaped pipe as one cell in every walk", () => {
    for (const table of splitGfmTables(ESCAPED)) {
      for (const row of table) {
        expect(row).toHaveLength(3);
      }
    }
  });

  it("does not throw in the walks that previously split naively", () => {
    expect(() => parseBeneficialOwnership(ESCAPED)).not.toThrow();
    expect(() => parseManagementRoster(ESCAPED)).not.toThrow();
  });
});
