/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CheerioAPI } from "cheerio";
import { NodeKind, renderMarkdown, uuid4 } from "workglow";
import type { TableCell, TableNode } from "workglow";
import { parseNumeric } from "./parseNumeric";

const LAYOUT_CHILD_TAGS = new Set([
  "p",
  "div",
  "table",
  "ul",
  "ol",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

function tagOf(el: unknown): string {
  const node = el as { tagName?: string; name?: string };
  return (node.tagName ?? node.name ?? "").toLowerCase();
}

const OFFERING_CAPTION = /^\s*(?:the|our)\s+offering\s*$/i;

function directRows($: CheerioAPI, table: unknown): unknown[] {
  return $(table as never)
    .find("> tr, > thead > tr, > tbody > tr, > tfoot > tr")
    .toArray();
}

/**
 * First row is a full-width "The Offering" caption sitting on a 2+ column
 * data table. The heading never becomes a heading node unless that row is
 * peeled before {@link extractTable}.
 */
export function leadingOfferingCaption(
  $: CheerioAPI,
  table: unknown
): { readonly row: unknown; readonly cell: unknown } | undefined {
  const rows = directRows($, table);
  if (rows.length < 2) return undefined;
  const first = rows[0];
  if (first === undefined) return undefined;
  const firstCells = $(first as never).children("td, th");
  if (firstCells.length !== 1) return undefined;
  if (!rows.slice(1).some((tr) => $(tr as never).children("td, th").length > 1)) {
    return undefined;
  }
  const cell = firstCells.get(0);
  if (cell === undefined) return undefined;
  const $cell = $(cell as never);
  const kids = $cell.children().toArray();
  for (const kid of kids) {
    const t = $(kid).text().replace(/\s+/g, " ").trim();
    if (t.length === 0) continue;
    return OFFERING_CAPTION.test(t) ? { row: first, cell } : undefined;
  }
  const t = $cell.text().replace(/\s+/g, " ").trim();
  return OFFERING_CAPTION.test(t) ? { row: first, cell } : undefined;
}

/**
 * True when a table is a 1-column typesetter wrapper (heading + intro in one
 * cell, or nested tables) rather than a 1-column data grid. A cell that is a
 * single `<p>` of values must stay a table; a cell with two or more block
 * children, or a nested `<table>`, is layout.
 */
export function isLayoutTable($: CheerioAPI, table: unknown): boolean {
  const rows = $(table as never)
    .find("> tr, > thead > tr, > tbody > tr, > tfoot > tr")
    .toArray();
  if (rows.length === 0) return false;
  if (rows.some((tr) => $(tr).children("td, th").length > 1)) return false;
  return rows.some((tr) => {
    const cell = $(tr).children("td, th").get(0);
    if (cell === undefined) return false;
    const blocks = $(cell)
      .children()
      .toArray()
      .filter((c) => LAYOUT_CHILD_TAGS.has(tagOf(c)));
    return blocks.some((c) => tagOf(c) === "table") || blocks.length >= 2;
  });
}

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
