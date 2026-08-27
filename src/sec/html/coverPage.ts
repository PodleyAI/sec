/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { NodeKind, uuid4 } from "workglow";
import type { ParagraphNode } from "workglow";
import { isTargetSectionLine } from "./joinSplitHeadings";
import type { EdgarBlock } from "./types";

/**
 * A filing's front matter, in the terms {@link HeadingDetector} reads it.
 *
 * A registration statement's cover page is typeset as a stack of short, bold,
 * centered, all-caps lines — the very shape a heading has — so every line of it
 * becomes a heading, and every heading becomes a section holding the one line
 * beneath it:
 *
 * ```
 * UNITED STATES                        15 chars
 * SECURITIES AND EXCHANGE COMMISSION   60 chars
 * FORM S-1                             10 chars
 * Vista, California 92081             428 chars
 * Krishna Vanka                       418 chars
 * ```
 *
 * Across the committed S-1 and 424 corpus that is 507 headings, ~12 per filing
 * and 14.2% of all sections, carrying 2.5% of the text. None of them names
 * anything; the reader wants one cover page and the section list wants to start
 * at the prospectus.
 *
 * The boundary is the table of contents. What precedes it is front matter by
 * construction — a document indexes itself before it begins.
 */
const TABLE_OF_CONTENTS = /^\s*(table of contents|index to (the )?(prospectus|financial))/i;

/**
 * How far in the table of contents is looked for.
 *
 * Front matter is short: across the 43 committed S-1 and 424 fixtures the
 * deepest table of contents sits at block 54, the median at 32. The bound is
 * what keeps a filing that indexes itself late — or names a section "Index to
 * the Prospectus" halfway down — from having real sections demoted; past it,
 * the filing keeps the untouched behaviour.
 */
const MAX_FRONT_MATTER_BLOCKS = 200;

/** A demoted heading keeps its text as prose, and its span with it. */
function asParagraph(text: string): ParagraphNode {
  return {
    nodeId: uuid4(),
    kind: NodeKind.PARAGRAPH,
    range: { startOffset: 0, endOffset: 0 },
    text,
  };
}

/**
 * Demote the headings a filing's cover page is typeset as, so front matter
 * becomes one preamble rather than a dozen one-line sections.
 *
 * Demoted, not dropped: the cover page carries the registrant's name and
 * address, the agent for service, and the preliminary-prospectus legend. It is
 * disclosure, and removing it would lose text the coverage measure counts.
 * A paragraph block is a leaf, so `buildDocument` never opens a section for it
 * and the text lands in the document's preamble instead.
 *
 * Runs **after** de-pagination on purpose. A typeset prospectus repeats "Table
 * of Contents" as a page back-link, cover pages included, so on the raw block
 * list the first match can be furniture rather than the index itself.
 *
 * A heading naming a section the segmenter targets is never demoted, the same
 * condition {@link joinSplitHeadings} guards on: a target must not lose the
 * heading it hangs on, whatever the rest of the rule says. No cover-page
 * heading in the committed corpus matches, so the guard costs nothing there and
 * covers the forms whose front matter is prose the corpus does not sample.
 */
export function demoteCoverPageHeadings(blocks: readonly EdgarBlock[]): EdgarBlock[] {
  const limit = Math.min(blocks.length, MAX_FRONT_MATTER_BLOCKS);
  let contents = -1;
  for (let i = 0; i < limit; i++) {
    const block = blocks[i]!;
    if (block.type === "heading" && TABLE_OF_CONTENTS.test(block.text)) {
      contents = i;
      break;
    }
  }
  // Not found, or the filing opens with it and there is no front matter.
  if (contents <= 0) return [...blocks];

  return blocks.map((block, i) =>
    i < contents && block.type === "heading" && !isTargetSectionLine(block.text)
      ? { type: "paragraph" as const, node: asParagraph(block.text), source: block.source }
      : block
  );
}
