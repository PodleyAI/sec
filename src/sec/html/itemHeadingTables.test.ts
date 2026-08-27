/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { NodeKind, uuid4 } from "workglow";
import type { TableNode } from "workglow";
import { itemHeadingFromTable, itemHeadingStyle } from "./itemHeadingTables";

const cell = (text: string): { text: string } => ({ text });

const table = (rows: string[][], caption?: string): TableNode =>
  ({
    nodeId: uuid4(),
    kind: NodeKind.TABLE,
    range: { startOffset: 0, endOffset: 0 },
    text: "",
    columnCount: Math.max(...rows.map((r) => r.length)),
    headerRows: [],
    rows: rows.map((r) => r.map(cell)),
    ...(caption === undefined ? {} : { caption }),
  }) as unknown as TableNode;

describe("itemHeadingFromTable", () => {
  it("recovers the two-cell row a filer typesets an item heading as", () => {
    expect(itemHeadingFromTable(table([["Item 8.01", "Other Events."]]))).toBe(
      "Item 8.01 Other Events."
    );
  });

  it("accepts the filer's own case and punctuation, and returns it as filed", () => {
    expect(
      itemHeadingFromTable(table([["ITEM 1.01.", "ENTRY INTO A MATERIAL DEFINITIVE AGREEMENT."]]))
    ).toBe("ITEM 1.01. ENTRY INTO A MATERIAL DEFINITIVE AGREEMENT.");
  });

  it("tolerates an empty spacer row", () => {
    expect(
      itemHeadingFromTable(
        table([
          ["", ""],
          ["Item 7.01", "Regulation FD Disclosure"],
        ])
      )
    ).toBe("Item 7.01 Regulation FD Disclosure");
  });

  it("rejects a table of contents, which runs on past the prescribed title", () => {
    // The index prints the same item text and then a page number and the next
    // item. Requiring the title to END where the regulation ends it is what
    // separates them — a prefix test passes both.
    expect(
      itemHeadingFromTable(
        table([
          ["ITEM 1.01. ENTRY INTO A MATERIAL DEFINITIVE AGREEMENT.", "3"],
          ["ITEM 7.01. REGULATION FD DISCLOSURE.", "3"],
        ])
      )
    ).toBeUndefined();
  });

  it("rejects a title that is not the one the regulation prescribes", () => {
    expect(itemHeadingFromTable(table([["Item 8.01", "Our Big Announcement"]]))).toBeUndefined();
  });

  it("rejects an item number Form 8-K does not define", () => {
    expect(itemHeadingFromTable(table([["Item 3.99", "Other Events"]]))).toBeUndefined();
  });

  it("leaves a real table alone", () => {
    expect(
      itemHeadingFromTable(
        table([
          ["Title of each class", "Trading symbol(s)"],
          ["Common Stock", "AAPL"],
        ])
      )
    ).toBeUndefined();
  });

  it("leaves a captioned table alone", () => {
    expect(
      itemHeadingFromTable(table([["Item 8.01", "Other Events."]], "The Offering"))
    ).toBeUndefined();
  });
});

describe("itemHeadingStyle", () => {
  it("measures upperRatio from the text so an all-caps item ranks with all-caps headings", () => {
    expect(itemHeadingStyle("ITEM 8.01 OTHER EVENTS").upperRatio).toBe(1);
    expect(itemHeadingStyle("Item 8.01 Other Events").upperRatio).toBeLessThan(0.3);
  });
  it("is bold at body size, so it ranks below a larger centered cover line", () => {
    const s = itemHeadingStyle("Item 8.01 Other Events");
    expect(s.bold).toBe(true);
    expect(s.centered).toBe(false);
    expect(s.fontSizePt).toBe(10);
  });
});
