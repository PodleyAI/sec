/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { headingAsParagraph } from "./joinSplitHeadings";
import type { EdgarBlock } from "./types";

/**
 * Whether a line is wholly one parenthetical — the first `(` closing on the
 * last character.
 *
 * The whole-line condition is what separates a caption from a title that merely
 * contains an aside: `Plan of Distribution (Conflict of Interest)` opens and
 * closes its parenthesis mid-line and is a real section. So does
 * `(a) Financial Statements (b) Exhibits`, which closes its first group early
 * and is a list rather than a caption, so the depth walk rejects it too.
 */
function isWhollyParenthetical(text: string): boolean {
  const line = text.trim();
  if (line.length < 3 || !line.startsWith("(") || !line.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) return false;
      // Closed before the end: two groups, not one wrapper.
      if (depth === 0 && i < line.length - 1) return false;
    }
  }
  return depth === 0;
}

/**
 * Demote a heading that is wholly a parenthetical, because it labels the line
 * above it rather than naming what follows.
 *
 * Registration statements and Exchange Act forms both caption their cover
 * fields this way — `(Exact name of registrant as specified in its charter)`
 * under the name, `(Address of principal executive offices, including Zip Code)`
 * under the address — and financial statements caption their units the same way.
 * Each is short, bold and centered, so `HeadingDetector` reads it as a heading,
 * and it then opens a section that holds everything until the next one.
 *
 * What that costs is the content, not the outline. The worst cases measured are
 * 21,556 and 19,669 characters of financial statements filed under
 * `(in thousands, except share and per share data)`, and three prospectus
 * supplements filing 7.5k-7.7k of Form 8-K disclosure apiece under
 * `(Former name or former address, if changed since last report)`. A reader
 * searching for the balance sheet finds a note about thousands.
 *
 * Demoting is also the right merge rather than merely a smaller one: the text
 * folds into the heading above, which is the caption's own subject — the
 * financial statements land under `CONSOLIDATED BALANCE SHEETS`.
 *
 * Measured share: 37 of 3,286 sections across the committed S-1 corpus (1.1%,
 * 99,336 characters) and 21 of 381 across 55 424B3 supplements pulled from
 * EDGAR (5.5%, 29,837 characters).
 *
 * Carries no target-section guard, unlike {@link joinSplitHeadings}. All 54 of
 * the segmenter's heading patterns are whole-line anchored, so a line wrapped in
 * parentheses cannot match one however it is spelled — a guard here would be
 * decoration that never fires. A target whose filer parenthesised it is a
 * caption by this rule's own definition, and there is none in either corpus.
 */
export function demoteParentheticalHeadings(blocks: readonly EdgarBlock[]): EdgarBlock[] {
  return blocks.map((block) =>
    block.type === "heading" && isWhollyParenthetical(block.text)
      ? headingAsParagraph(block)
      : block
  );
}
