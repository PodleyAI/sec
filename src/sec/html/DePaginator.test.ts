/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { depaginate } from "./DePaginator";
import type { EdgarBlock, ResolvedStyle } from "./types";
import { NodeKind, uuid4 } from "workglow";
import type { ParagraphNode, TableCell, TableNode } from "workglow";

const style: ResolvedStyle = {
  fontSizePt: 14,
  bold: true,
  italic: false,
  underline: false,
  centered: true,
  upperRatio: 1,
};
/**
 * Synthetic source spans, ten units apart in construction order. Real spans
 * come from parse5 and the de-paginator only ever unions them, so any
 * increasing sequence exercises the stitch; the gaps make a merged span
 * visibly wider than either half.
 */
let nextSpanStart = 0;
const span = (): { readonly start: number; readonly end: number } => {
  const start = nextSpanStart;
  nextSpanStart += 10;
  return { start, end: start + 5 };
};
const pageBreak = (): EdgarBlock => ({ type: "page-break", source: span() });
const heading = (text: string): EdgarBlock => ({
  type: "heading",
  text,
  style,
  level: 2,
  source: span(),
});
const para = (text: string): EdgarBlock => ({
  type: "paragraph",
  node: {
    nodeId: uuid4(),
    kind: NodeKind.PARAGRAPH,
    range: { startOffset: 0, endOffset: 0 },
    text,
  } as ParagraphNode,
  source: span(),
});
const cell = (t: string, isHeader = false): TableCell => ({
  text: t,
  colspan: 1,
  rowspan: 1,
  isHeader,
  numeric: undefined,
});
const table = (headerRows: TableCell[][], rows: TableCell[][]): EdgarBlock => ({
  type: "table",
  node: {
    nodeId: uuid4(),
    kind: NodeKind.TABLE,
    range: { startOffset: 0, endOffset: 0 },
    text: "",
    caption: undefined,
    columnCount: (headerRows[0] ?? rows[0]).length,
    headerRows,
    rows,
    stitchedFrom: 1,
  } as TableNode,
  source: span(),
});

describe("depaginate", () => {
  it("drops the repeats of a running header, keeping its first occurrence", () => {
    const blocks: EdgarBlock[] = [];
    for (let i = 0; i < 6; i++) {
      blocks.push(para("ACME CORPORATION"), para(`Real content ${i}`));
    }
    const out = depaginate(blocks);
    const acme = out.filter((b) => b.type === "paragraph" && b.node.text === "ACME CORPORATION");
    expect(acme).toHaveLength(1);
    expect(out[0]).toBe(acme[0]);
    expect(out.filter((b) => b.type === "paragraph").length).toBe(7);
  });

  it("drops the repeats of a running header styled as a heading, keeping the first", () => {
    const blocks: EdgarBlock[] = [];
    for (let i = 0; i < 6; i++) {
      blocks.push(heading("Table of Contents"), para(`Real content ${i}`));
    }
    const out = depaginate(blocks);
    expect(out.filter((b) => b.type === "heading")).toHaveLength(1);
    expect(out[0]).toEqual(expect.objectContaining({ type: "heading", text: "Table of Contents" }));
    expect(out.filter((b) => b.type === "paragraph").length).toBe(6);
  });

  it("keeps every occurrence of a target section heading, however often it repeats", () => {
    const blocks: EdgarBlock[] = [];
    for (let i = 0; i < 6; i++) {
      blocks.push(heading("MANAGEMENT"), para(`Management page ${i}`));
    }
    const out = depaginate(blocks);
    // The segmenter picks the occurrence with the most body, so the de-paginator
    // must not decide for it by thinning them down to the first.
    expect(out.filter((b) => b.type === "heading")).toHaveLength(6);
  });

  it("keeps a repeated section heading whose page furniture is dropped around it", () => {
    const blocks: EdgarBlock[] = [];
    for (let i = 0; i < 6; i++) {
      blocks.push(
        heading("THE OFFERING"),
        para("ACME CORPORATION"),
        para(`Offering page ${i} body text`)
      );
    }
    const out = depaginate(blocks);
    expect(out.filter((b) => b.type === "heading")).toHaveLength(6);
    expect(
      out.filter((b) => b.type === "paragraph" && b.node.text === "ACME CORPORATION")
    ).toHaveLength(1);
  });

  it("keeps a heading that repeats only a few times (table of contents + body)", () => {
    const blocks: EdgarBlock[] = [heading("MANAGEMENT"), para("body"), heading("MANAGEMENT")];
    const out = depaginate(blocks);
    expect(out.filter((b) => b.type === "heading")).toHaveLength(2);
  });

  it("keeps a heading whose words are also repeated as running prose", () => {
    const blocks: EdgarBlock[] = [heading("PROSPECTUS SUMMARY")];
    for (let i = 0; i < 6; i++) blocks.push(para("Prospectus Summary"), para(`page ${i} body`));
    const out = depaginate(blocks);
    expect(out.filter((b) => b.type === "heading")).toHaveLength(1);
    // The prose repeats are furniture and thin down to one; the heading is
    // tallied separately, so they never vote it away.
    expect(
      out.filter((b) => b.type === "paragraph" && b.node.text === "Prospectus Summary")
    ).toHaveLength(1);
  });

  it("keeps a heading that starts a page, unlike an adjacent short paragraph", () => {
    const blocks: EdgarBlock[] = [
      para("tail of the previous page"),
      pageBreak(),
      heading("THE OFFERING"),
      para("The offering body runs on from here."),
    ];
    const out = depaginate(blocks);
    expect(out.some((b) => b.type === "heading" && b.text === "THE OFFERING")).toBe(true);
  });

  it("stitches a table split across a page break with a repeated header", () => {
    const header = [[cell("Name", true), cell("Shares", true)]];
    const blocks: EdgarBlock[] = [
      table(header, [[cell("Alice"), cell("1")]]),
      pageBreak(),
      para("ACME CORPORATION"),
      table(header, [[cell("Bob"), cell("2")]]),
    ];
    const out = depaginate(blocks);
    const tables = out.filter((b) => b.type === "table") as Array<{ node: TableNode }>;
    expect(tables).toHaveLength(1);
    expect(tables[0].node.rows).toHaveLength(2);
    expect(tables[0].node.stitchedFrom).toBe(2);
    expect(tables[0].node.headerRows).toHaveLength(1);
  });

  it("does NOT merge two distinct adjacent tables with different column counts", () => {
    const blocks: EdgarBlock[] = [
      table([[cell("A", true), cell("B", true)]], [[cell("1"), cell("2")]]),
      pageBreak(),
      table([[cell("X", true)]], [[cell("9")]]),
    ];
    const out = depaginate(blocks);
    expect(out.filter((b) => b.type === "table")).toHaveLength(2);
  });
});
