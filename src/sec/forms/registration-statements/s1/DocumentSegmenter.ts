/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DocumentRootNode } from "workglow";
import type { S1SectionName } from "../../../html/sectionVocabulary";
import type { SourceSpan } from "../../../html/types";

export interface Section {
  readonly name: S1SectionName;
  readonly text: string; // GFM rendering of the section subtree
  /**
   * Half-open `[start, end)` span of the **filing HTML** this body was rendered
   * from — a **bounding range, not a slice**.
   *
   * It is the union over the section's leaf blocks, so every block of the
   * section lies inside it, but `html.slice(start, end)` does not reconstitute
   * `text`. Measured over the 44 committed fixtures: for 313 of 370 resolved
   * sections the blocks inside the span are exactly the section's, for 29 the
   * span also covers blocks the section does not carry (a body truncated at a
   * swallowed sibling, or a slice taken out of a container), and for 28 the two
   * differ by a few characters — the titles of nested sub-headings, which the
   * tree builder mints without a link back to any block. Use it to highlight a
   * region, never to re-derive the text.
   *
   * Undefined when a text-level fallback recovered the section and there is no
   * mapping back to the source at all. Undefined rather than a pair of zeros,
   * and deliberately not `DocumentNode.range`: the tree builder overwrites that
   * with a running count over concatenated node text, so it indexes neither the
   * HTML, the rendered markdown, nor this `text`. A consumer that cannot tell
   * "unknown" from "offset 0" highlights the top of the document every time.
   */
  readonly source: SourceSpan | undefined;
}

export interface DocumentSegmenter {
  /** Returns one Section per target heading found in the document tree. */
  segment(doc: DocumentRootNode): readonly Section[];
}
