/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

const SHORT_LEN = 100;

/**
 * A roman numeral in the range front matter actually uses: i through xlix,
 * minus the two single letters that mean something else on their own.
 *
 * Bounded deliberately, not for tidiness. Canonical form alone is not enough of
 * a filter, because English words ARE canonical roman numerals — `mix` is
 * M+IX, 1009 — and a rule accepting the full range eats a one-word paragraph
 * that happens to spell one. Excluding `m`, `d` and `c` removes every such word
 * while still reaching 49, and a prospectus that numbered its front matter past
 * xlix would be a prospectus with fifty pages of front matter.
 *
 * A bare single letter is admitted only as `i` or `v`. Alone, `x` is a checkbox
 * mark and a multiplication sign long before it is ten, and dropping one costs
 * the reader the box that was ticked; `l` is excluded entirely, which is what
 * bounds the rule at `xlix` — with `l` allowed as a tens digit the pattern ran
 * to `lxxxix`, well past the range the argument above covers. Neither is a loss: across the fixture corpus the single-letter
 * matches are 36 `i` and 8 `v`, front matter never reaches `x` (it stops at
 * `ix`), and no filing carries a lone `x` or `l` at all.
 */
const ROMAN_NUMERAL = /^(?=[ivxl]{2,}$|[iv]$)(xl|x{0,3})(ix|iv|v?i{0,3})$/i;

/**
 * A section-prefixed page number: `F-22`, `II-1`, `A-3`, `Alt-8`.
 *
 * Prospectuses number their front matter, financial statements and Part II
 * separately from the body — `F-` for the financial statements, `II-` for Part
 * II, `Alt-` for the alternate pages a dual-tranche offering carries.
 *
 * The prefixes are ENUMERATED, not `[a-z]{1,3}`. That shape also spells every
 * short form type and exhibit code — `S-1`, `S-4`, `N-2`, `T-3`, `EX-99` — and
 * a one-cell layout table is unwrapped to a paragraph before this runs, which
 * is exactly where an exhibit index or a cover page puts a block whose whole
 * text is one of those. Dropping it counts the block as depaginated rather
 * than lost, so the coverage measure reports nothing wrong. These four are the
 * conventions the corpus actually numbers with.
 */
const PREFIXED_PAGE_NUMBER = /^(?:f|ii|a|alt)-\d{1,3}$/i;

/**
 * A centered page-number footer: `41`, `- 12 -`, `Page 7`, `iv`, `F-22`, `II-1`.
 *
 * The roman and prefixed forms are here because prospectuses use them for whole
 * runs of pages — 50 `F-n` pages in one filing's financial statements — and a
 * rule that only knew bare digits left every one of them in the text. Measured
 * over the 42-filing fixture corpus, the two added forms match 374 blocks and
 * every one is a page number; nothing else in the corpus matches them.
 */
export function isPageNumber(text: string): boolean {
  const t = text.trim();
  if (t.length > SHORT_LEN) return false;
  if (/^\W*page\s+\d+\W*$/i.test(t) || /^[-\s]*\d{1,4}[-\s]*$/.test(t)) return true;
  // The decorative dashes a centered footer is often wrapped in.
  const bare = t.replace(/^[-\s]+|[-\s]+$/g, "");
  return ROMAN_NUMERAL.test(bare) || PREFIXED_PAGE_NUMBER.test(bare);
}

/**
 * Per-page "Table of Contents" back-link text. Exact match only — the real TOC
 * section title is usually a heading (`TABLE OF CONTENTS`) and must stay.
 */
export function isTocBackLink(text: string): boolean {
  return /^table of contents$/i.test(text.replace(/\s+/g, " ").trim());
}

/** Leaf prose that must not coalesce with adjacent body text. */
export function isPageFurniture(text: string): boolean {
  return isTocBackLink(text) || isPageNumber(text);
}
