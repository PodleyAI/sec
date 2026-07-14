/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { normalizeManagementTitle, normalizeManagementTitles } from "./normalizeTitle";

describe("normalizeManagementTitle", () => {
  // Each pair is [raw model output, canonical form]. These are the recurring
  // phrasings the cross-model eval surfaced.
  const cases: ReadonlyArray<readonly [string, string]> = [
    // possessive board reference -> "the Board"
    ["Chairman of our board of directors", "Chairman of the Board of Directors"],
    ["Chairman of the Company's board of directors", "Chairman of the Board of Directors"],
    // bare board seat -> "Director"
    ["Member of the Board of Directors", "Director"],
    ["member of our board of directors", "Director"],
    ["a member of the board", "Director"],
    // drop an article before a role
    ["Chief Executive Officer and a director", "Chief Executive Officer and Director"],
    // bare board chair expands to canonical
    ["Chairman of the Board", "Chairman of the Board of Directors"],
    ["Chair of the Board", "Chair of the Board of Directors"],
    [
      "Chief Executive Officer and Chairman of the Board",
      "Chief Executive Officer and Chairman of the Board of Directors",
    ],
    // a bare "Board of Directors" as the whole title is a directorship
    ["Board of Directors", "Director"],
    ["the Board of Directors", "Director"],
    // a trailing bare "Chair*" (whole title or after "and") is the board chair
    ["Chairman", "Chairman of the Board of Directors"],
    ["Chair", "Chair of the Board of Directors"],
    ["Chairwoman", "Chairwoman of the Board of Directors"],
    [
      "Chief Executive Officer and Chairman",
      "Chief Executive Officer and Chairman of the Board of Directors",
    ],
    // a committee chair is NOT the board chair — left untouched
    ["Chairman of the Audit Committee", "Chairman of the Audit Committee"],
    // Title Case + acronym preservation
    ["chief financial officer", "Chief Financial Officer"],
    ["CEO", "CEO"],
    // already-canonical stays put
    ["Director", "Director"],
    ["Chief Technology Officer", "Chief Technology Officer"],
    ["Chairman of the Board of Directors", "Chairman of the Board of Directors"],
  ];

  for (const [raw, canonical] of cases) {
    it(`"${raw}" -> "${canonical}"`, () => {
      expect(normalizeManagementTitle(raw)).toBe(canonical);
    });
  }

  it("is idempotent — normalizing a canonical title is a no-op", () => {
    for (const [, canonical] of cases) {
      expect(normalizeManagementTitle(canonical)).toBe(canonical);
    }
  });

  it("trims and collapses whitespace, and leaves an empty title empty", () => {
    expect(normalizeManagementTitle("  Chief   Executive  Officer  ")).toBe(
      "Chief Executive Officer"
    );
    expect(normalizeManagementTitle("   ")).toBe("");
  });
});

describe("normalizeManagementTitles", () => {
  // [raw input, expected roles] — a compound title splits into distinct roles,
  // each canonicalized.
  const cases: ReadonlyArray<readonly [string | string[] | null, string[]]> = [
    ["Chief Executive Officer and Director", ["Chief Executive Officer", "Director"]],
    [
      "Chief Executive Officer and a director",
      ["Chief Executive Officer", "Director"],
    ],
    [
      "President, Chief Financial Officer and Secretary",
      ["President", "Chief Financial Officer", "Secretary"],
    ],
    // Oxford comma before "and"
    ["President, CEO, and Director", ["President", "CEO", "Director"]],
    // a single role stays a one-element list, canonicalized
    ["chairman of our board of directors", ["Chairman of the Board of Directors"]],
    ["Director", ["Director"]],
    // a role containing no separator is not split
    ["Chairman of the Board of Directors", ["Chairman of the Board of Directors"]],
    // de-duplication (case-insensitive)
    ["Director and director", ["Director"]],
    // already-split list input is re-split/normalized defensively
    [["Chief Executive Officer and Director"], ["Chief Executive Officer", "Director"]],
    [["President", "Secretary"], ["President", "Secretary"]],
    // empty / null -> []
    ["", []],
    [null, []],
    [[], []],
  ];

  for (const [raw, roles] of cases) {
    it(`${JSON.stringify(raw)} -> ${JSON.stringify(roles)}`, () => {
      expect(normalizeManagementTitles(raw)).toEqual(roles);
    });
  }

  it("is idempotent on an already-split, canonical list", () => {
    for (const [, roles] of cases) {
      expect(normalizeManagementTitles(roles)).toEqual(roles);
    }
  });
});
