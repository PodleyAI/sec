/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CheerioAPI } from "cheerio";
import { NodeKind, renderMarkdown, uuid4 } from "workglow";
import type { TableCell, TableNode } from "workglow";
import { parseNumeric } from "./parseNumeric";

/** Convert a <table> element into a rectangular, colspan/rowspan-expanded TableNode. */
export function extractTable($: CheerioAPI, table: unknown): TableNode {
  const rowEls = $(table as never)
    .find("tr")
    .toArray();

  // Dense grid: grid[row][col] — may have holes during construction.
  const grid: (TableCell | null)[][] = [];

  // Carry-forward slots from rowspan > 1 cells.
  // Each entry says: at (col), fill with `cell` for `remaining` more rows.
  let carry: { cell: TableCell; remaining: number; col: number }[] = [];

  rowEls.forEach((tr) => {
    const rowIndex = grid.length;
    grid.push([]);

    // Drop carry entries exhausted by a previous row so `carry` cannot grow
    // unbounded on large tables, then fill this row's still-active carried cells
    // (a new explicit cell never lands on a carried column — place() skips them).
    carry = carry.filter((c) => c.remaining > 0);
    for (const c of carry) {
      grid[rowIndex][c.col] = c.cell;
      c.remaining -= 1;
    }

    const cellEls = $(tr).find("th,td").toArray();
    // Track which logical column we are currently placing into.
    let col = 0;

    for (const cellEl of cellEls) {
      // Advance past any column already filled by a carried rowspan cell.
      while (grid[rowIndex][col] !== undefined && grid[rowIndex][col] !== null) {
        col += 1;
      }

      const $cell = $(cellEl);
      const node = cellEl as { tagName?: string; name?: string };
      const isHeader = (node.tagName ?? node.name ?? "").toLowerCase() === "th";
      const text = $cell.text().replace(/\s+/g, " ").trim();
      const colspan = Math.max(1, Number($cell.attr("colspan") ?? "1") || 1);
      const rowspan = Math.max(1, Number($cell.attr("rowspan") ?? "1") || 1);
      const cell: TableCell = { text, colspan, rowspan, isHeader, numeric: parseNumeric(text) };

      // Place this cell across its colspan columns.
      for (let i = 0; i < colspan; i++) {
        grid[rowIndex][col + i] = cell;
      }

      // Register rowspan carry for subsequent rows.
      if (rowspan > 1) {
        for (let i = 0; i < colspan; i++) {
          carry.push({ cell, remaining: rowspan - 1, col: col + i });
        }
      }

      col += colspan;
    }
  });

  // Determine the grid width (max filled column index + 1).
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);

  // Normalize: fill any remaining holes with empty cells.
  const norm: TableCell[][] = grid.map((r) => {
    const filled: TableCell[] = [];
    for (let c = 0; c < width; c++) {
      filled.push(
        r[c] ?? { text: "", colspan: 1, rowspan: 1, isHeader: false, numeric: undefined }
      );
    }
    return filled;
  });

  // Drop columns that are entirely empty across all rows (spacer columns).
  const keep: number[] = [];
  for (let c = 0; c < width; c++) {
    if (norm.some((r) => r[c].text.length > 0)) keep.push(c);
  }
  const pruned = norm.map((r) => keep.map((c) => r[c]));

  // Partition: leading rows whose every cell is a header cell → headerRows; rest → bodyRows.
  const headerRows: TableCell[][] = [];
  const bodyRows: TableCell[][] = [];
  let inHeader = true;
  for (const r of pruned) {
    if (inHeader && r.length > 0 && r.every((c) => c.isHeader)) {
      headerRows.push(r);
    } else {
      inHeader = false;
      bodyRows.push(r);
    }
  }

  const columnCount = keep.length;
  const node: TableNode = {
    nodeId: uuid4(),
    kind: NodeKind.TABLE,
    range: { startOffset: 0, endOffset: 0 },
    text: "",
    caption: undefined,
    columnCount,
    headerRows,
    rows: bodyRows,
    stitchedFrom: 1,
  };
  return { ...node, text: renderMarkdown(node) };
}
