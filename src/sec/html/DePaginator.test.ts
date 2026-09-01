/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import type { ParagraphNode, TableCell, TableNode } from "workglow";
import { NodeKind, uuid4 } from "workglow";
import { depaginate, depaginateWithTrace } from "./DePaginator";
import type { EdgarBlock, ResolvedStyle } from "./types";

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

/**
 * A one-cell table: the layout box EDGAR filers wrap page furniture in. Rendered
 * to markdown it is the `|  | / | --- | / | F-22 |` grid that litters a
 * converted filing, which is what these tests are here to keep out.
 */
const boxed = (text: string, caption: string | undefined = undefined): EdgarBlock => ({
  type: "table",
  node: {
    nodeId: uuid4(),
    kind: NodeKind.TABLE,
    range: { startOffset: 0, endOffset: 0 },
    text: "",
    caption,
    columnCount: 1,
    headerRows: [],
    rows: [[cell(text)]],
    stitchedFrom: 1,
  } as TableNode,
  source: span(),
});

describe("depaginate: single-cell tables", () => {
  it("drops a page number the filer wrapped in a one-cell table", () => {
    const { blocks, dropped } = depaginateWithTrace([para("Body text that stays."), boxed("F-22")]);
    expect(blocks.filter((b) => b.type === "table")).toHaveLength(0);
    expect(blocks).toHaveLength(1);
    expect(dropped.map((d) => [d.reason, d.text])).toEqual([["page-number", "F-22"]]);
  });

  it("drops the empty-header-plus-one-value shape, the commonest form of it", () => {
    // What the filer emits is a header cell holding nothing and a body cell
    // holding the number; `filled.length` counts what is actually there.
    const { blocks, dropped } = depaginateWithTrace([table([[cell("", true)]], [[cell("F-22")]])]);
    expect(blocks).toHaveLength(0);
    expect(dropped.map((d) => d.reason)).toEqual(["page-number"]);
  });

  it("attributes the drop to the table's own bytes", () => {
    const block = boxed("F-22");
    const { dropped } = depaginateWithTrace([block]);
    expect(dropped[0].source).toEqual(block.source);
  });

  it("votes a table-wrapped back-link into the repetition tally", () => {
    // The per-page "Table of Contents" link matches no pattern — only repetition
    // identifies it — so the unwrap has to happen before the tally, not after.
    const blocks: EdgarBlock[] = [];
    for (let i = 0; i < 6; i++) blocks.push(boxed("Table of Contents"), para(`Page ${i} body`));
    const out = depaginate(blocks);
    expect(out.filter((b) => b.type === "table")).toHaveLength(0);
    expect(
      out.filter((b) => b.type === "paragraph" && b.node.text === "Table of Contents")
    ).toHaveLength(1);
  });

  it("unwraps a one-cell table of prose without dropping it", () => {
    const prose =
      "The Company was incorporated in Delaware on March 3, 2021 for the purpose of " +
      "effecting a merger with one or more businesses.";
    const { blocks, dropped } = depaginateWithTrace([boxed(prose)]);
    expect(dropped).toHaveLength(0);
    expect(blocks).toEqual([
      expect.objectContaining({
        type: "paragraph",
        node: expect.objectContaining({ text: prose }),
      }),
    ]);
  });

  it("leaves a captioned one-cell table alone", () => {
    // The caption is information a paragraph has nowhere to put.
    const out = depaginate([boxed("41", "Shares outstanding")]);
    expect(out.filter((b) => b.type === "table")).toHaveLength(1);
  });

  it("leaves a table with more than one filled cell alone", () => {
    const out = depaginate([table([[cell("Name", true)]], [[cell("Alice")], [cell("Bob")]])]);
    expect(out.filter((b) => b.type === "table")).toHaveLength(1);
  });
});
