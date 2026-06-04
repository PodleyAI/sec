/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { DocumentRootNode } from "workglow";
import { parseToBlocks } from "./parseToBlocks";
import { depaginate } from "./DePaginator";
import { buildDocument } from "./buildDocument";

/**
 * Convert EDGAR filing HTML into a hierarchical Document: style-inferred heading
 * hierarchy, structured tables/lists/images, with page furniture stripped and
 * page-split tables stitched. Form-agnostic; pure and synchronous.
 */
export function parseEdgarHtml(html: string, title: string): DocumentRootNode {
  const blocks = parseToBlocks(html);
  const clean = depaginate(blocks);
  return buildDocument(title, clean);
}
