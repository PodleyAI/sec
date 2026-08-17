/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { S1_SECTIONS, SECTION_HEADING_PATTERNS } from "./DocumentSegmenter";
import type { S1SectionName } from "./DocumentSegmenter";

/** What the segmenter does to a heading before matching it. */
function match(heading: string): S1SectionName | null {
  const line = heading.replace(/\s+/g, " ").trim();
  for (const name of Object.keys(SECTION_HEADING_PATTERNS) as S1SectionName[]) {
    if (SECTION_HEADING_PATTERNS[name].some((re) => re.test(line))) return name;
  }
  return null;
}

/**
 * Headings taken verbatim from real EDGAR registration statements, each with
 * the CIK it came from. Every one of these was a filing whose section was lost
 * until the pattern was added, so this table is the regression record: a
 * pattern narrowed in future fails here rather than silently dropping a
 * disclosure again.
 */
const REAL_HEADINGS: ReadonlyArray<{
  readonly heading: string;
  readonly expect: S1SectionName;
  readonly cik: string;
}> = [
  // FINRA Rule 5121 conflicts qualifier, dash-punctuated rather than parenthesized.
  {
    heading: "UNDERWRITING—CONFLICTS OF INTEREST",
    expect: S1_SECTIONS.UNDERWRITING,
    cik: "1819399",
  },
  { heading: "Underwriting (Conflicts of Interest)", expect: S1_SECTIONS.UNDERWRITING, cik: "-" },
  // Form 20-F Item 6 vocabulary, which an F-1 uses.
  { heading: "DIRECTORS AND MANAGEMENT", expect: S1_SECTIONS.MANAGEMENT, cik: "1819794" },
  {
    heading: "Directors, Senior Management and Employees",
    expect: S1_SECTIONS.MANAGEMENT,
    cik: "-",
  },
  { heading: "Board of Directors and Management", expect: S1_SECTIONS.MANAGEMENT, cik: "-" },
  // Form 20-F Item 7, whose combined heading leads with the ownership table.
  {
    heading: "MAJOR SHAREHOLDERS AND RELATED PARTY TRANSACTIONS",
    expect: S1_SECTIONS.BENEFICIAL_OWNERSHIP,
    cik: "1826000",
  },
  // The older, shorter Item 404 spelling.
  { heading: "CERTAIN TRANSACTIONS", expect: S1_SECTIONS.RELATED_PARTY, cik: "2042460" },
  // Item 401 for a smaller reporting company.
  {
    heading: "DIRECTORS, EXECUTIVE OFFICERS, PROMOTERS AND CONTROL PERSONS",
    expect: S1_SECTIONS.MANAGEMENT,
    cik: "-",
  },
  // An F-1 brands its offering block this way.
  { heading: "Summary Terms of The Offering", expect: S1_SECTIONS.THE_OFFERING, cik: "-" },
  // Pyrophyte Acquisition Corp. II 424B4 (CIK 2069238): the offering table
  // sits under this heading, not "The Offering".
  { heading: "Terms of Our Offering", expect: S1_SECTIONS.THE_OFFERING, cik: "2069238" },
  // A SPAC that brands its roster rather than titling it.
  { heading: "Our Team", expect: S1_SECTIONS.MANAGEMENT, cik: "1828108" },
  // Live 2134856 Karman Line: the roster sits under a FINRA-style conflicts
  // qualifier, same dash family as UNDERWRITING—CONFLICTS OF INTEREST.
  {
    heading: "Management — Conflicts of Interest",
    expect: S1_SECTIONS.MANAGEMENT,
    cik: "2134856",
  },
  {
    heading: "MANAGEMENT—CONFLICTS OF INTEREST",
    expect: S1_SECTIONS.MANAGEMENT,
    cik: "2134856",
  },
  // The actual Karman SectionNode title — converter emits this, not the
  // "Management — Conflicts of Interest" cross-refs in body prose.
  {
    heading: "MANAGEMENT AND ADVISORS",
    expect: S1_SECTIONS.MANAGEMENT,
    cik: "2134856",
  },
  { heading: "Management and Advisors", expect: S1_SECTIONS.MANAGEMENT, cik: "2134856" },
];

/**
 * Prose that must NOT be read as a heading. Whole-line anchoring is what keeps
 * a body sentence mentioning a section name from opening a section.
 */
const NOT_HEADINGS: readonly string[] = [
  "The underwriting discounts and commissions are set forth below.",
  "Underwriting — Conflicts of Interest are described under that caption.",
  "Our directors and management have agreed to vote their founder shares.",
  "See “Certain Transactions” for a description of these arrangements.",
  "Summary of the Offering Terms and Conditions of the Units Being Offered",
  "Our team has completed six acquisitions.",
  "See Management — Conflicts of Interest for a discussion of these arrangements.",
];

describe("S-1 section heading patterns", () => {
  it.each(REAL_HEADINGS)("matches $heading (CIK $cik)", ({ heading, expect: want }) => {
    expect(match(heading)).toBe(want);
  });

  it.each(NOT_HEADINGS)("does not read body prose as a heading: %s", (line) => {
    expect(match(line)).toBeNull();
  });

  it("does not read the Item 402(r) director table as the executive one", () => {
    // Its rows are directors, not named executive officers; a filing folding
    // both under one heading is matched, because the executive table is inside.
    expect(match("Director Compensation")).toBeNull();
    expect(match("Executive and Director Compensation")).toBe(S1_SECTIONS.EXECUTIVE_COMPENSATION);
  });

  it("every declared section has at least one pattern", () => {
    for (const name of Object.values(S1_SECTIONS)) {
      expect(SECTION_HEADING_PATTERNS[name].length).toBeGreaterThan(0);
    }
  });
});
