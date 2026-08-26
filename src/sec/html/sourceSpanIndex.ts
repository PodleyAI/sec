/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { NodeKind, traverseDepthFirst } from "workglow";
import type { DocumentNode } from "workglow";
import type { EdgarBlock, SourceSpan } from "./types";

/**
 * Where each of a document's leaf nodes came from in the filing HTML.
 *
 * Keyed by `nodeId` because that is what survives the tree build: for a leaf,
 * `buildDocumentTree` shallow-copies the node the converter handed it, so the
 * id is carried through. Section nodes are NOT in here — the tree builder mints
 * those itself from a heading, with a fresh id and no link back to the block.
 */
export type SourceSpanIndex = ReadonlyMap<string, SourceSpan>;

/** Index the blocks that became leaf nodes. Headings and page breaks have no node. */
export function buildSourceSpanIndex(blocks: readonly EdgarBlock[]): SourceSpanIndex {
  const index = new Map<string, SourceSpan>();
  for (const block of blocks) {
    if (block.type === "heading" || block.type === "page-break") continue;
    index.set(block.node.nodeId, block.source);
  }
  return index;
}

/**
 * The filing HTML a node's **content** came from: the union over every leaf
 * beneath it, or the node's own span when it is itself a leaf.
 *
 * Deliberately excludes a section's heading line. A `Section` carries the
 * rendered body (`renderChildren(section.children)`), not the heading, so a
 * span covering the heading would describe more than the text it accompanies.
 *
 * Returns undefined when nothing beneath the node is indexed — an empty
 * section, or a node built by a path that has no source mapping at all.
 */
export function subtreeSourceSpan(
  node: DocumentNode,
  index: SourceSpanIndex
): SourceSpan | undefined {
  let start = -1;
  let end = -1;
  for (const descendant of traverseDepthFirst(node)) {
    if (descendant.kind === NodeKind.SECTION || descendant.kind === NodeKind.DOCUMENT) continue;
    const span = index.get(descendant.nodeId);
    if (span === undefined) continue;
    if (start === -1 || span.start < start) start = span.start;
    if (span.end > end) end = span.end;
  }
  return start === -1 ? undefined : { start, end };
}
