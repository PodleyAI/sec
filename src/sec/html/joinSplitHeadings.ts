/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { SECTION_HEADING_PATTERNS } from "./sectionVocabulary";
import type { EdgarBlock, ResolvedStyle } from "./types";

/**
 * Whether a line names a section the segmenter builds sections from.
 *
 * Shared with the de-paginator, which exempts such headings from its repetition
 * rule. Here it is the safety condition on a join: fusing two headings must
 * never leave a target section without a heading to hang on.
 */
export function isTargetSectionLine(text: string): boolean {
  const line = text.replace(/\s+/g, " ").trim();
  return Object.values(SECTION_HEADING_PATTERNS).some((patterns) =>
    patterns.some((re) => re.test(line))
  );
}

/**
 * Function words a title cannot end on, so a heading ending in one is the first
 * line of a heading that continues.
 *
 * Articles are deliberately absent. `a` is the one that would pay: the corpus
 * has a subheading split after "…Disposition of Class A". It is also the one
 * that cannot be told from a designator label — `Annex A`, `Exhibit A`,
 * `Schedule A` are complete headings that a following sibling must not be
 * glued to, and nothing in the two lines distinguishes those cases. Every word
 * below is unambiguous: none of them labels anything. The trade is one missed
 * join against a class of wrong ones.
 */
const DANGLING_WORD = /\b(of|and|or|for|to|in|with|on|by)$/i;

/**
 * The typographic fields, which is what "the filer styled these the same" means.
 *
 * `upperRatio` is excluded on purpose: it is measured from the text, not
 * declared by the filer, so two halves of one heading differ in it whenever
 * they contain different words. All three style-mismatched pairs in the corpus
 * differ in nothing else, and requiring whole-style identity would drop them.
 */
function typography(s: ResolvedStyle): string {
  return `${s.fontSizePt}|${s.bold}|${s.italic}|${s.underline}|${s.centered}`;
}

/**
 * Rejoin a heading the filer typeset across two block elements.
 *
 * A filer with a title too long for one line writes it as two sibling `<p>`s
 * with identical styling. `parseToBlocks` coalesces contiguous prose but emits
 * one heading candidate per block element, so the document gets two headings —
 * the first holding no body at all, the second holding everything. On the page
 * that reads as an empty section followed by a mistitled one:
 *
 * ```
 * MANAGEMENT'S DISCUSSION AND ANALYSIS OF            41 chars
 * FINANCIAL CONDITION AND RESULTS OF OPERATIONS   56,378 chars
 * ```
 *
 * Four conditions have to hold together, because no one of them is selective
 * enough. Across the 43-filing fixture corpus there are 693 adjacent same-level
 * heading pairs and 681 of them share typography, so typography alone would
 * fuse the whole outline; it is the dangling word that identifies a
 * continuation, and it fires on 15 of 4,890 headings.
 *
 * Runs of three or more lines fold left, so the second join sees the text of
 * the first.
 *
 * Deliberately ahead of the de-paginator, on the block stream as the walk
 * emitted it. Adjacency then means adjacency: after furniture is dropped, two
 * headings with a page number between them look adjacent, and joining across
 * a page boundary is exactly the case this has no evidence for. Measured both
 * ways over the corpus the candidate set is identical, so the safer order is
 * free.
 */
export function joinSplitHeadings(blocks: readonly EdgarBlock[]): EdgarBlock[] {
  const out: EdgarBlock[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      prev.type === "heading" &&
      b.type === "heading" &&
      prev.level === b.level &&
      typography(prev.style) === typography(b.style) &&
      DANGLING_WORD.test(prev.text.replace(/\s+/g, " ").trim())
    ) {
      const text = `${prev.text.replace(/\s+$/, "")} ${b.text.replace(/^\s+/, "")}`;
      // Never at the cost of a section the extractors segment on: if either
      // half names one and the join does not, the join loses more than the
      // split reader does.
      const wouldLoseSection =
        (isTargetSectionLine(prev.text) || isTargetSectionLine(b.text)) &&
        !isTargetSectionLine(text);
      if (!wouldLoseSection) {
        out[out.length - 1] = {
          type: "heading",
          text,
          // The first half's style. Its `upperRatio` now describes only part of
          // the text, which costs nothing: the two readers of that field,
          // `StyleResolver` and `HeadingDetector`, both run inside
          // `parseToBlocks` and are finished before this does anything.
          style: prev.style,
          level: prev.level,
          source: { start: prev.source.start, end: b.source.end },
        };
        continue;
      }
    }
    out.push(b);
  }
  return out;
}
