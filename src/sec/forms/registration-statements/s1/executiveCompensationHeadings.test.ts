/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  S1_SECTIONS,
  SECTION_HEADING_PATTERNS,
  type S1SectionName,
} from "../../../html/sectionVocabulary";

/** Mirrors the segmenter's own matcher: first target whose pattern spans the line. */
function match(title: string): S1SectionName | null {
  const line = title.replace(/\s+/g, " ").trim();
  for (const name of Object.keys(SECTION_HEADING_PATTERNS) as S1SectionName[]) {
    if (SECTION_HEADING_PATTERNS[name].some((re) => re.test(line))) return name;
  }
  return null;
}

describe("executive-compensation heading patterns", () => {
  it("matches the spellings real registration statements use", () => {
    // Observed across EDGAR filings: operating companies split the disclosure out
    // ("Executive Compensation"), small registrants combine it with the director
    // table, and SPACs almost always use one of the two officer-and-director
    // spellings.
    for (const heading of [
      "EXECUTIVE COMPENSATION",
      "Our Executive Compensation",
      "Executive Compensation and Other Information",
      "EXECUTIVE AND DIRECTOR COMPENSATION",
      "Director and Executive Officer Compensation",
      "COMPENSATION OF DIRECTORS AND EXECUTIVE OFFICERS",
      "Compensation of Our Executive Officers",
      "Officer and Director Compensation",
      "Executive Officer and Director Compensation",
      "Management Compensation",
      "Summary Compensation Table",
    ]) {
      expect(match(heading), heading).toBe(S1_SECTIONS.EXECUTIVE_COMPENSATION);
    }
  });

  it("does not claim the standalone director-compensation table", () => {
    // Item 402(r) is a separate table whose rows are non-employee directors, not
    // named executive officers. When a filing gives it its own heading it must
    // stay out of the section the compensation extractor reads.
    for (const heading of [
      "DIRECTOR COMPENSATION",
      "Director Compensation",
      "Non-Employee Director Compensation",
    ]) {
      expect(match(heading), heading).not.toBe(S1_SECTIONS.EXECUTIVE_COMPENSATION);
    }
  });

  it("does not steal the management section's headings", () => {
    for (const heading of [
      "MANAGEMENT",
      "Directors and Executive Officers",
      "Executive Officers and Directors",
    ]) {
      expect(match(heading), heading).toBe(S1_SECTIONS.MANAGEMENT);
    }
  });
});
