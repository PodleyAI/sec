/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { NodeKind, uuid4 } from "workglow";
import { demoteParentheticalHeadings } from "./parentheticalHeadings";
import type { EdgarBlock, ResolvedStyle } from "./types";

const STYLE: ResolvedStyle = {
  fontSizePt: 10,
  bold: true,
  italic: true,
  underline: false,
  centered: true,
  upperRatio: 0.1,
};

let nextSpanStart = 0;
const span = (): { readonly start: number; readonly end: number } => {
  const start = nextSpanStart;
  nextSpanStart += 10;
  return { start, end: start + 5 };
};
const heading = (text: string): EdgarBlock => ({
  type: "heading",
  text,
  style: STYLE,
  level: 3,
  source: span(),
});
const para = (text: string): EdgarBlock => ({
  type: "paragraph",
  node: {
    nodeId: uuid4(),
    kind: NodeKind.PARAGRAPH,
    range: { startOffset: 0, endOffset: 0 },
    text,
  },
  source: span(),
});

const kinds = (blocks: readonly EdgarBlock[]): string[] =>
  blocks.map((b) =>
    b.type === "heading" ? `H:${b.text}` : b.type === "paragraph" ? `P:${b.node.text}` : b.type
  );

describe("demoteParentheticalHeadings", () => {
  it("demotes a heading that is wholly one parenthetical", () => {
    const out = demoteParentheticalHeadings([
      heading("CONSOLIDATED BALANCE SHEETS"),
      heading("(in thousands, except share and per share data)"),
      para("Total assets…"),
    ]);
    expect(kinds(out)).toEqual([
      "H:CONSOLIDATED BALANCE SHEETS",
      "P:(in thousands, except share and per share data)",
      "P:Total assets…",
    ]);
  });

  it("keeps a title that merely contains a parenthetical aside", () => {
    const out = demoteParentheticalHeadings([
      heading("Plan of Distribution (Conflict of Interest)"),
      heading("(the “Fund”)"),
    ]);
    expect(kinds(out)).toEqual(["H:Plan of Distribution (Conflict of Interest)", "P:(the “Fund”)"]);
  });

  it("keeps a line that closes its first group early", () => {
    // Two groups, not one wrapper — an item list, not a caption.
    const blocks = [heading("(a) Financial Statements (b) Exhibits")];
    expect(demoteParentheticalHeadings(blocks)).toEqual(blocks);
  });

  it("demotes a target section name its filer parenthesised", () => {
    // Not an exception: every segmenter pattern is whole-line anchored, so a
    // parenthesised line never names a target, and by this rule it is a caption.
    const [out] = demoteParentheticalHeadings([heading("(Risk Factors)")]);
    expect(out?.type).toBe("paragraph");
  });

  it("keeps the demoted heading's text and source span", () => {
    const caption = heading("(Exact name of registrant as specified in its charter)");
    const [out] = demoteParentheticalHeadings([caption]);
    expect(out?.type).toBe("paragraph");
    expect(out?.source).toEqual(caption.source);
    expect(out?.type === "paragraph" && out.node.text).toBe(
      "(Exact name of registrant as specified in its charter)"
    );
  });

  it("leaves unparenthesised headings and non-heading blocks alone", () => {
    const blocks = [heading("RISK FACTORS"), para("(a note in prose)")];
    expect(demoteParentheticalHeadings(blocks)).toEqual(blocks);
  });
});
