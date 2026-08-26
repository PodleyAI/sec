/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ImageNode, ListNode, ParagraphNode, TableNode } from "workglow";

/** Style facts resolved from the inline-style cascade for one DOM node. */
export interface ResolvedStyle {
  readonly fontSizePt: number; // normalized to points; base 10pt
  readonly bold: boolean; // font-weight >= 600
  readonly italic: boolean;
  readonly underline: boolean;
  readonly centered: boolean;
  readonly upperRatio: number; // 0..1 fraction of letters that are uppercase
}

/**
 * Half-open `[start, end)` span of the **original filing HTML** a block was
 * built from, in UTF-16 code units of the string handed to `parseEdgarHtml`.
 *
 * This is the only link back to the source. `DocumentNode.range` is not it:
 * `buildDocumentTree` overwrites whatever a converter puts there with a running
 * count over concatenated node `text`, which indexes neither the HTML nor the
 * markdown any consumer actually holds.
 *
 * A block the walk could not locate carries a **zero-width** span at the
 * position reached so far rather than a guess. Zero width is the honest answer
 * — such a block claims no source text — and it keeps a coverage measurement
 * from crediting the parser for bytes it cannot account for.
 */
export interface SourceSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * Internal flat block emitted by the DOM walk, consumed by the de-paginator and
 * tree builder. Headings carry a candidate style so HeadingDetector can rank
 * levels; page-break markers are dropped before the tree is built (the
 * de-paginator drops page furniture in place rather than emitting a marker).
 *
 * `source` rides along on every variant and is read by nothing in the
 * extraction path — `buildDocument` ignores it, so the document tree is
 * unaffected by its presence. It exists for the verification trace.
 */
export type EdgarBlock =
  | {
      readonly type: "heading";
      readonly text: string;
      readonly style: ResolvedStyle;
      readonly level: number;
      readonly source: SourceSpan;
    }
  | { readonly type: "paragraph"; readonly node: ParagraphNode; readonly source: SourceSpan }
  | { readonly type: "table"; readonly node: TableNode; readonly source: SourceSpan }
  | { readonly type: "list"; readonly node: ListNode; readonly source: SourceSpan }
  | { readonly type: "image"; readonly node: ImageNode; readonly source: SourceSpan }
  | { readonly type: "page-break"; readonly source: SourceSpan };
