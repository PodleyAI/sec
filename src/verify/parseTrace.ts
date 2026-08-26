/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DroppedBlock } from "../sec/html/DePaginator";
import { parseEdgarHtmlWithTrace, type EdgarParseTrace } from "../sec/html/parseEdgarHtml";
import type { EdgarBlock, SourceSpan } from "../sec/html/types";
import { measureCoverage, type CoverageReport } from "./coverage";

/** One surviving block as the trace records it. */
export interface ParseBlockRecord {
  readonly index: number;
  readonly type: EdgarBlock["type"];
  readonly source: SourceSpan;
  readonly text: string;
  readonly headingLevel: number | undefined;
  readonly table:
    | {
        readonly columns: number;
        readonly headerRows: number;
        readonly rows: number;
        readonly stitchedFrom: number;
      }
    | undefined;
}

export interface ParseTrace {
  readonly title: string;
  readonly htmlLength: number;
  readonly blocks: readonly ParseBlockRecord[];
  readonly dropped: readonly DroppedBlock[];
  readonly coverage: CoverageReport;
}

function record(b: EdgarBlock, index: number): ParseBlockRecord {
  const table =
    b.type === "table"
      ? {
          columns: b.node.columnCount,
          headerRows: b.node.headerRows.length,
          rows: b.node.rows.length,
          stitchedFrom: b.node.stitchedFrom,
        }
      : undefined;
  return {
    index,
    type: b.type,
    source: b.source,
    text: blockText(b),
    headingLevel: b.type === "heading" ? b.level : undefined,
    table,
  };
}

function blockText(b: EdgarBlock): string {
  return b.type === "heading" ? b.text : b.type === "page-break" ? "" : b.node.text;
}

/**
 * Parse a filing and account for what the parser did with it.
 *
 * `parsed` lets a caller that already parsed hand the result in rather than pay
 * for a second walk — a 7 MB filing is seconds of work, and the segmenter needs
 * the same `doc` and span index this built from.
 */
export function buildParseTrace(
  html: string,
  title: string,
  parsed: EdgarParseTrace = parseEdgarHtmlWithTrace(html, title)
): ParseTrace {
  const { blocks, dropped } = parsed;
  return {
    title,
    htmlLength: html.length,
    blocks: blocks.map(record),
    dropped,
    coverage: measureCoverage(
      html,
      blocks.map((b) => ({ type: b.type, source: b.source, text: blockText(b) })),
      dropped.map((d) => ({ type: `dropped:${d.reason}`, source: d.source, text: d.text }))
    ),
  };
}
