/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { NodeKind, uuid4 } from "workglow";
import type { ParagraphNode } from "workglow";
import { isTargetSectionLine, joinSplitHeadings } from "./joinSplitHeadings";
import type { EdgarBlock, ResolvedStyle } from "./types";

const STYLE: ResolvedStyle = {
  fontSizePt: 10,
  bold: true,
  italic: false,
  underline: false,
  centered: true,
  upperRatio: 1,
};

let nextSpanStart = 0;
const span = (): { readonly start: number; readonly end: number } => {
  const start = nextSpanStart;
  nextSpanStart += 10;
  return { start, end: start + 5 };
};
const heading = (text: string, style: ResolvedStyle = STYLE, level = 2): EdgarBlock => ({
  type: "heading",
  text,
  style,
  level,
  source: span(),
});
const para = (text: string): EdgarBlock => ({
  type: "paragraph",
  node: {
    nodeId: uuid4(),
    kind: NodeKind.PARAGRAPH,
    range: { startOffset: 0, endOffset: text.length },
    text,
  } as ParagraphNode,
  source: span(),
});
const texts = (blocks: readonly EdgarBlock[]): string[] =>
  blocks.map((b) => (b.type === "heading" ? b.text : "·"));

describe("joinSplitHeadings", () => {
  it("rejoins the heading a filer typeset on two lines", () => {
    const out = joinSplitHeadings([
      heading("MANAGEMENT'S DISCUSSION AND ANALYSIS OF"),
      heading("FINANCIAL CONDITION AND RESULTS OF OPERATIONS"),
      para("We are a blank check company."),
    ]);
    expect(texts(out)).toEqual([
      "MANAGEMENT'S DISCUSSION AND ANALYSIS OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS",
      "·",
    ]);
  });

  it("covers both halves' bytes, so the joined heading stays attributable", () => {
    const a = heading("CONSOLIDATED STATEMENTS OF STOCK AND");
    const b = heading("STOCKHOLDERS' DEFICIT");
    const out = joinSplitHeadings([a, b]);
    expect(out[0].source).toEqual({ start: a.source.start, end: b.source.end });
  });

  it("collapses the newline the filer wrapped the line at", () => {
    const out = joinSplitHeadings([heading("SUMMARY OF   \n"), heading("\n  THE OFFERING")]);
    expect(texts(out)).toEqual(["SUMMARY OF THE OFFERING"]);
  });

  it("folds a heading split across three lines", () => {
    const out = joinSplitHeadings([
      heading("RISKS RELATING TO"),
      heading("OUR SEARCH FOR AND"),
      heading("CONSUMMATION OF A BUSINESS COMBINATION"),
    ]);
    expect(texts(out)).toEqual([
      "RISKS RELATING TO OUR SEARCH FOR AND CONSUMMATION OF A BUSINESS COMBINATION",
    ]);
  });

  it("leaves two complete adjacent headings alone", () => {
    // The common case by far: 693 adjacent same-level pairs in the corpus, and
    // all but 15 headings end on a word that can finish a title.
    const out = joinSplitHeadings([heading("THE OFFERING"), heading("RISK FACTORS")]);
    expect(texts(out)).toEqual(["THE OFFERING", "RISK FACTORS"]);
  });

  it("does not join across intervening content", () => {
    const out = joinSplitHeadings([
      heading("MANAGEMENT'S DISCUSSION AND ANALYSIS OF"),
      para("Some paragraph the filer put between them."),
      heading("FINANCIAL CONDITION AND RESULTS OF OPERATIONS"),
    ]);
    expect(texts(out)).toHaveLength(3);
  });

  it("does not join headings the filer styled differently", () => {
    const out = joinSplitHeadings([
      heading("SUMMARY OF"),
      heading("THE OFFERING", { ...STYLE, fontSizePt: 14 }),
    ]);
    expect(texts(out)).toEqual(["SUMMARY OF", "THE OFFERING"]);
  });

  it("does not join headings the detector ranked at different levels", () => {
    const out = joinSplitHeadings([heading("SUMMARY OF"), heading("THE OFFERING", STYLE, 3)]);
    expect(texts(out)).toEqual(["SUMMARY OF", "THE OFFERING"]);
  });

  it("ignores a difference in upperRatio, which is measured from the text", () => {
    // Both `Management's Discussion and Analysis of` pairs in the corpus differ
    // in this field and nothing else; comparing whole styles would drop them.
    const out = joinSplitHeadings([
      heading("Management's Discussion and Analysis of", { ...STYLE, upperRatio: 0.09 }),
      heading("Financial Condition and Results of Operations", { ...STYLE, upperRatio: 0.1 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("refuses a join that would leave a target section with no heading", () => {
    // `MANAGEMENT` is what the roster extractor segments on. Gluing it to the
    // line above buys a tidier outline and costs the section.
    const out = joinSplitHeadings([heading("SHARES ELIGIBLE FOR"), heading("MANAGEMENT")]);
    expect(texts(out)).toEqual(["SHARES ELIGIBLE FOR", "MANAGEMENT"]);
  });

  it("allows a join that keeps the target section matchable", () => {
    // `security ownership[^\n]*` still matches once the tail is glued on.
    const out = joinSplitHeadings([
      heading("SECURITY OWNERSHIP OF"),
      heading("CERTAIN BENEFICIAL OWNERS"),
    ]);
    expect(texts(out)).toEqual(["SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS"]);
    expect(isTargetSectionLine(out[0].type === "heading" ? out[0].text : "")).toBe(true);
  });

  it("does not treat a trailing article as a continuation", () => {
    // `Annex A` / `Exhibit A` are complete headings, and nothing in the two
    // lines separates them from a genuine `… of Class A` wrap.
    const out = joinSplitHeadings([heading("ANNEX A"), heading("FORM OF CHARTER")]);
    expect(texts(out)).toEqual(["ANNEX A", "FORM OF CHARTER"]);
  });

  it("matches the trailing word only as a whole word", () => {
    const out = joinSplitHeadings([heading("CAPITALIZATION"), heading("DILUTION")]);
    expect(texts(out)).toEqual(["CAPITALIZATION", "DILUTION"]);
  });

  it("returns the input unchanged when there is nothing to join", () => {
    const blocks = [para("a"), heading("THE OFFERING"), para("b")];
    expect(joinSplitHeadings(blocks)).toEqual(blocks);
  });
});
