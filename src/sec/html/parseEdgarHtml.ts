/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DocumentRootNode } from "workglow";
import { parseToBlocks } from "./parseToBlocks";
import { depaginateWithTrace, type DroppedBlock } from "./DePaginator";
import { buildDocument } from "./buildDocument";
import type { EdgarBlock } from "./types";

/**
 * The document, plus what the parser did to produce it.
 *
 * `blocks` are the surviving blocks in document order, each carrying the
 * `[start, end)` span of filing HTML it was built from — the only link from
 * anything downstream back to the source. `DocumentNode.range` is not that
 * link: `buildDocumentTree` replaces it with a running count over concatenated
 * node text, which indexes neither the HTML nor the rendered markdown.
 *
 * `dropped` is what the de-paginator removed, so a missing paragraph can be
 * attributed to a rule here rather than guessed at.
 */
export interface EdgarParseTrace {
  readonly doc: DocumentRootNode;
  readonly blocks: readonly EdgarBlock[];
  readonly dropped: readonly DroppedBlock[];
}

/**
 * Convert EDGAR filing HTML into a hierarchical Document: style-inferred heading
 * hierarchy, structured tables/lists/images, with page furniture stripped and
 * page-split tables stitched. Form-agnostic; pure and synchronous.
 */
export function parseEdgarHtml(html: string, title: string): DocumentRootNode {
  return parseEdgarHtmlWithTrace(html, title).doc;
}

/**
 * {@link parseEdgarHtml}, also returning the block-level source provenance the
 * verification trace reads.
 *
 * The document it produces is identical to what `parseEdgarHtml` returns —
 * `buildDocument` ignores the `source` spans entirely — so nothing in the
 * extraction path changes by tracing a filing.
 */
export function parseEdgarHtmlWithTrace(html: string, title: string): EdgarParseTrace {
  const blocks = parseToBlocks(html);
  const { blocks: clean, dropped } = depaginateWithTrace(blocks);
  return { doc: buildDocument(title, clean), blocks: clean, dropped };
}
