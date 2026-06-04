/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { renderMarkdown } from "workglow";
import type { TableCell, TableNode } from "workglow";
import type { EdgarBlock } from "./types";

const FREQ_THRESHOLD = 5;
const SHORT_LEN = 100;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isPageNumber(text: string): boolean {
  const t = text.trim();
  if (t.length > SHORT_LEN) return false;
  return /^\W*page\s+\d+\W*$/i.test(t) || /^[-\s]*\d{1,4}[-\s]*$/.test(t);
}

/** Mark furniture (running headers/footers, page numbers) and drop it; then stitch. */
export function depaginate(blocks: EdgarBlock[]): EdgarBlock[] {
  // --- Pass 1: frequency table of short prose ---
  const freq = new Map<string, number>();
  for (const b of blocks) {
    if (b.type === "paragraph") {
      const t = b.node.text;
      if (t.length <= SHORT_LEN) freq.set(normalize(t), (freq.get(normalize(t)) ?? 0) + 1);
    }
  }

  const isAdjacentToBreak = (i: number): boolean =>
    blocks[i - 1]?.type === "page-break" || blocks[i + 1]?.type === "page-break";

  // --- Pass 2: classify + drop furniture (keep page-break markers for stitching) ---
  const kept: EdgarBlock[] = [];
  blocks.forEach((b, i) => {
    if (b.type === "paragraph") {
      const t = b.node.text;
      if (isPageNumber(t)) return;
      if (t.length <= SHORT_LEN) {
        const f = freq.get(normalize(t)) ?? 0;
        if (f >= FREQ_THRESHOLD) return;
        if (isAdjacentToBreak(i)) return;
      }
    }
    kept.push(b);
  });

  // --- Pass 3: conservative stitch across page breaks ---
  const stitched: EdgarBlock[] = [];
  for (const b of kept) {
    if (b.type === "page-break") {
      stitched.push(b);
      continue;
    }
    if (b.type === "table") {
      const prev = stitched[stitched.length - 1];
      const beforeBreak = stitched[stitched.length - 2];
      if (
        prev?.type === "page-break" &&
        beforeBreak?.type === "table" &&
        canStitch(beforeBreak.node, b.node)
      ) {
        const merged = stitchTables(beforeBreak.node, b.node);
        stitched.splice(stitched.length - 2, 2, { type: "table", node: merged });
        continue;
      }
    }
    stitched.push(b);
  }

  // --- Pass 4: drop remaining page-break markers ---
  return stitched.filter((b) => b.type !== "page-break");
}

/** Conservative: same column count, and continuation either repeats header or has none. */
function canStitch(a: TableNode, b: TableNode): boolean {
  if (a.columnCount !== b.columnCount) return false;
  if (b.headerRows.length === 0) return true;
  return headerRowsEqual(a.headerRows, b.headerRows);
}

function headerRowsEqual(a: TableCell[][], b: TableCell[][]): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c++) {
      if (a[r][c].text.trim() !== b[r][c].text.trim()) return false;
    }
  }
  return true;
}

function stitchTables(a: TableNode, b: TableNode): TableNode {
  const merged: TableNode = {
    ...a,
    rows: [...a.rows, ...b.rows],
    stitchedFrom: a.stitchedFrom + b.stitchedFrom,
    text: "",
  };
  return { ...merged, text: renderMarkdown(merged) };
}
