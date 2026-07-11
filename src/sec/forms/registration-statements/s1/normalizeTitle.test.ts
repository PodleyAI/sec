/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { normalizeManagementTitle } from "./normalizeTitle";

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
