/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { isPageNumber, isTocBackLink } from "./pageFurniture";

describe("isPageNumber", () => {
  it("takes the arabic footer forms", () => {
    for (const t of ["1", "41", "1234", "- 12 -", "Page 7", "page 12."]) {
      expect(isPageNumber(t), t).toBe(true);
    }
  });

  it("wraps in ASCII dashes only, which is what the corpus contains", () => {
    // Recorded rather than fixed: no em-dash-wrapped page number appears in the
    // 42-filing fixture corpus, and widening a furniture rule on a guess is how
    // it starts eating content.
    expect(isPageNumber("\u20147\u2014")).toBe(false);
  });

  it("takes the roman numerals front matter is numbered with", () => {
    for (const t of ["i", "ii", "iii", "iv", "v", "ix", "xiv", "XL", "- vii -"]) {
      expect(isPageNumber(t), t).toBe(true);
    }
  });

  it("takes the section-prefixed forms a prospectus numbers its parts with", () => {
    // `F-` financial statements, `II-` Part II, `Alt-` the alternate pages a
    // dual-tranche offering carries. One filing in the corpus runs to F-50.
    for (const t of ["F-1", "F-22", "F-50", "II-1", "II-15", "A-3", "Alt-8"]) {
      expect(isPageNumber(t), t).toBe(true);
    }
  });

  it("does not take a form type or an exhibit code", () => {
    // `[a-z]{1,3}-\d{1,3}` also spells every short form type and exhibit
    // number. A one-cell layout table is unwrapped to a paragraph BEFORE this
    // test runs, and an exhibit index or a cover page is exactly where a block
    // whose whole text is `EX-99` or `S-1` comes from — dropped here it leaves
    // the document counted as depaginated rather than lost, so the coverage
    // measure reports nothing wrong. The prefixes a prospectus actually
    // numbers with are the four above, and none of these is one.
    for (const t of ["S-1", "S-4", "N-2", "T-3", "EX-99", "EX-10", "EX-3"]) {
      expect(isPageNumber(t), t).toBe(false);
    }
  });

  it("does not take a bare `x` or `l`, whatever they are worth in roman", () => {
    // `x` alone is a checkbox mark and a multiplication sign long before it is
    // ten, and front matter stops at `ix` in every filing in the corpus.
    for (const t of ["x", "X", "l", "L"]) {
      expect(isPageNumber(t), t).toBe(false);
    }
  });

  it("stops at the xlix its bound claims, rather than running to lxxxix", () => {
    // The rule's safety argument is that front matter never runs past 49
    // pages. `l?x{0,3}` admitted `li` through `lxxxix` anyway, so the range it
    // implemented was not the one the argument covers. Erring toward keeping
    // text: a stray numeral left in the document is recoverable, a dropped
    // block is counted as depaginated and reads as nothing lost.
    for (const t of ["i", "iv", "ix", "xxxix", "xl", "xlix"]) {
      expect(isPageNumber(t), t).toBe(true);
    }
    for (const t of ["l", "li", "lv", "lx", "lxxxix"]) {
      expect(isPageNumber(t), t).toBe(false);
    }
  });

  it("does not take an English word that happens to be a roman numeral", () => {
    // `mix` is M+IX — 1009 — and canonical, so a well-formedness check alone
    // does not exclude it. The range cap does: front matter never reaches `m`.
    for (const t of ["mix", "did", "civic", "mild", "dim", "MIX"]) {
      expect(isPageNumber(t), t).toBe(false);
    }
  });

  it("does not take prose, dates or figures that merely start with digits", () => {
    for (const t of [
      "41 shares",
      "Item 1A",
      "2026-01-01",
      "Risk Factors",
      "$1,234",
      "(123)",
      "1.01",
      "",
      "   ",
    ]) {
      expect(isPageNumber(t), t).toBe(false);
    }
  });

  it("refuses anything long, whatever it looks like", () => {
    expect(isPageNumber(`F-1 ${"x".repeat(200)}`)).toBe(false);
  });
});

describe("isTocBackLink", () => {
  it("matches the per-page back-link exactly, not the section title in prose", () => {
    expect(isTocBackLink("Table of Contents")).toBe(true);
    expect(isTocBackLink("  TABLE OF CONTENTS  ")).toBe(true);
    expect(isTocBackLink("Table of Contents (continued)")).toBe(false);
    expect(isTocBackLink("See the Table of Contents")).toBe(false);
  });
});
