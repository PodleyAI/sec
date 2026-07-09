/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { depaginate } from "./DePaginator";
import type { EdgarBlock } from "./types";
import { NodeKind, uuid4 } from "workglow";
import type { ParagraphNode, TableCell, TableNode } from "workglow";

const para = (text: string): EdgarBlock => ({
  type: "paragraph",
  node: {
    nodeId: uuid4(),
    kind: NodeKind.PARAGRAPH,
    range: { startOffset: 0, endOffset: 0 },
    text,
  } as ParagraphNode,
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
});

describe("depaginate", () => {
  it("drops a running header repeated >= 5 times", () => {
    const blocks: EdgarBlock[] = [];
    for (let i = 0; i < 6; i++) {
      blocks.push(para("ACME CORPORATION"), para(`Real content ${i}`));
    }
    const out = depaginate(blocks);
    expect(out.some((b) => b.type === "paragraph" && b.node.text === "ACME CORPORATION")).toBe(
      false
    );
    expect(out.filter((b) => b.type === "paragraph").length).toBe(6);
  });

  it("stitches a table split across a page break with a repeated header", () => {
    const header = [[cell("Name", true), cell("Shares", true)]];
    const blocks: EdgarBlock[] = [
      table(header, [[cell("Alice"), cell("1")]]),
      { type: "page-break" },
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
      { type: "page-break" },
      table([[cell("X", true)]], [[cell("9")]]),
    ];
    const out = depaginate(blocks);
    expect(out.filter((b) => b.type === "table")).toHaveLength(2);
  });
});
