/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TableCell, TableNode } from "workglow";
import { NodeKind, renderMarkdown, uuid4 } from "workglow";
import { isTargetSectionLine } from "./joinSplitHeadings";
import { isPageNumber } from "./pageFurniture";
import type { EdgarBlock, SourceSpan } from "./types";

const FREQ_THRESHOLD = 5;
const SHORT_LEN = 100;

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Key a block votes under in the repetition tally, or undefined when it is not
 * eligible (not short text). Headings and paragraphs are tallied separately: a
 * phrase repeated as body text must not vote away the single heading that spells
 * the same words, since dropping a heading also unparents that section's body.
 */
function furnitureKey(b: EdgarBlock): string | undefined {
  const text = b.type === "paragraph" ? b.node.text : b.type === "heading" ? b.text : undefined;
  if (text === undefined || text.length > SHORT_LEN) return undefined;
  return `${b.type}:${normalize(text)}`;
}

/**
 * A table carrying exactly one non-empty cell, as the paragraph it really is.
 *
 * EDGAR filers wrap page furniture in tables constantly — a footer page number,
 * the per-page "Table of Contents" back-link — and a one-cell table is not a
 * table at all, it is a layout box with a line of text in it. `isLayoutTable`
 * does not catch these: it looks for a cell holding BLOCK children, and these
 * cells hold bare text.
 *
 * That mattered more than it looks. Every furniture rule below reads
 * paragraphs, so anything the walk emitted as a table was never even tested:
 * across the 42-filing fixture corpus, 1,338 of 1,741 single-cell tables
 * already matched `isPageNumber` or `isTocBackLink` and survived anyway, and
 * each one reached the reader as a phantom one-column grid. Unwrapping first
 * puts them in front of the rules that were always meant to catch them.
 *
 * A table with a caption is left alone: the caption is information a paragraph
 * has nowhere to put.
 */
function unwrapSingleCellTable(b: EdgarBlock): EdgarBlock {
  if (b.type !== "table" || b.node.caption) return b;
  const cells = [...b.node.headerRows, ...b.node.rows].flat();
  const filled = cells.filter((c) => c.text.trim() !== "");
  if (filled.length !== 1) return b;
  const text = filled[0].text.trim();
  return {
    type: "paragraph",
    node: {
      nodeId: uuid4(),
      kind: NodeKind.PARAGRAPH,
      range: { startOffset: 0, endOffset: text.length },
      text,
    },
    // The span is the TABLE's, so the unwrapped text still points at the bytes
    // it came from and a drop of it stays attributable.
    source: b.source,
  };
}

/**
 * Whether a heading names a section the segmenter builds sections from. Such a
 * heading is exempt from the repetition rule entirely: a prospectus that prints
 * its section title as the running header of every page inside that section
 * would otherwise vote the real heading away, and losing it unparents the whole
 * section into its predecessor. Which occurrence is the real one is left to the
 * segmenter, which already keeps the occurrence with the most body text.
 *
 * The exemption reads the segmenter's own pattern table, so a section added
 * there is protected here without a second list to keep in sync.
 */
function isTargetSectionHeading(b: EdgarBlock): boolean {
  return b.type === "heading" && isTargetSectionLine(b.text);
}

/**
 * Why the de-paginator removed a block, in the vocabulary its three rules use.
 *
 * Kept apart rather than collapsed into "furniture" because they answer
 * different questions when a section comes up short: `repeated-furniture` means
 * the text appeared {@link FREQ_THRESHOLD}+ times and a later copy lost,
 * `page-number` means it was a bare numeral, and `near-page-break` means a
 * short paragraph sat against a page boundary. Only the last two can eat prose
 * that the filing states exactly once.
 */
export const DROP_REASONS = ["repeated-furniture", "page-number", "near-page-break"] as const;
export type DropReason = (typeof DROP_REASONS)[number];

/** One removed block, with enough of it to recognize in a coverage report. */
export interface DroppedBlock {
  readonly reason: DropReason;
  readonly source: SourceSpan;
  readonly text: string;
}

export interface DepaginateResult {
  readonly blocks: EdgarBlock[];
  readonly dropped: readonly DroppedBlock[];
}

/** The text a block contributes to the filing, for a drop report. */
function blockText(b: EdgarBlock): string {
  switch (b.type) {
    case "heading":
      return b.text;
    case "paragraph":
    case "table":
    case "list":
    case "image":
      return b.node.text;
    case "page-break":
      return "";
  }
}

/** Mark furniture (running headers/footers, page numbers) and drop it; then stitch. */
export function depaginate(blocks: EdgarBlock[]): EdgarBlock[] {
  return depaginateWithTrace(blocks).blocks;
}

/**
 * {@link depaginate}, also reporting what it removed and why.
 *
 * The drop list is the verification trace's account of this stage: a section
 * that arrives at an extractor missing a paragraph the filing plainly contains
 * is either a walk that never emitted it or a rule here that ate it, and
 * without this there is no way to tell those apart.
 */
export function depaginateWithTrace(input: EdgarBlock[]): DepaginateResult {
  // --- Pass 0: a one-cell table is a paragraph in a layout box ---
  // Before the tally, so an unwrapped block votes in it: the per-page "Table of
  // Contents" back-link is table-wrapped in most filings, and it is the
  // repetition rule rather than any pattern that identifies it.
  const blocks = input.map(unwrapSingleCellTable);

  // --- Pass 1: frequency table of short prose and short heading text ---
  const freq = new Map<string, number>();
  for (const b of blocks) {
    const key = furnitureKey(b);
    if (key !== undefined) freq.set(key, (freq.get(key) ?? 0) + 1);
  }

  const isAdjacentToBreak = (i: number): boolean =>
    blocks[i - 1]?.type === "page-break" || blocks[i + 1]?.type === "page-break";

  // --- Pass 2: classify + drop furniture (keep page-break markers for stitching) ---
  // Repetition identifies furniture, but the text itself is still content that
  // appeared in the filing: only the repeats are page furniture, so the first
  // surviving occurrence is kept and every later one dropped.
  const kept: EdgarBlock[] = [];
  const dropped: DroppedBlock[] = [];
  const keptOnce = new Set<string>();
  const drop = (b: EdgarBlock, reason: DropReason): void => {
    dropped.push({ reason, source: b.source, text: blockText(b) });
  };
  blocks.forEach((b, i) => {
    const key = furnitureKey(b);
    const repeatKey =
      key !== undefined && (freq.get(key) ?? 0) >= FREQ_THRESHOLD && !isTargetSectionHeading(b)
        ? key
        : undefined;
    if (repeatKey !== undefined && keptOnce.has(repeatKey)) return drop(b, "repeated-furniture");
    if (b.type === "paragraph") {
      const t = b.node.text;
      if (isPageNumber(t)) return drop(b, "page-number");
      // Page-break adjacency stays a paragraph-only signal. A genuine section
      // heading normally starts a fresh page, so extending it to headings would
      // strip the very titles the tree is built from.
      if (t.length <= SHORT_LEN && isAdjacentToBreak(i)) return drop(b, "near-page-break");
    }
    // Recorded only once the block survives the remaining rules, so a first
    // occurrence dropped as a page number or page-break neighbour does not
    // spend the one slot its later occurrences would otherwise have filled.
    if (repeatKey !== undefined) keptOnce.add(repeatKey);
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
        // The stitched table covers both halves and the break between them, so
        // its span runs from the first half's start to the second half's end.
        // Anything narrower would leave the continuation's rows unattributed.
        stitched.splice(stitched.length - 2, 2, {
          type: "table",
          node: merged,
          source: { start: beforeBreak.source.start, end: b.source.end },
        });
        continue;
      }
    }
    stitched.push(b);
  }

  // --- Pass 4: drop remaining page-break markers ---
  // Not reported as drops: a marker is our own annotation of a page boundary,
  // not filing content, so it has nothing to account for.
  return { blocks: stitched.filter((b) => b.type !== "page-break"), dropped };
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
