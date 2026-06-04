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
 * Internal flat block emitted by the DOM walk, consumed by the de-paginator and
 * tree builder. Headings carry a candidate style so HeadingDetector can rank
 * levels; page-break markers are dropped before the tree is built (the
 * de-paginator drops page furniture in place rather than emitting a marker).
 */
export type EdgarBlock =
  | {
      readonly type: "heading";
      readonly text: string;
      readonly style: ResolvedStyle;
      readonly level: number;
    }
  | { readonly type: "paragraph"; readonly node: ParagraphNode }
  | { readonly type: "table"; readonly node: TableNode }
  | { readonly type: "list"; readonly node: ListNode }
  | { readonly type: "image"; readonly node: ImageNode }
  | { readonly type: "page-break" };
