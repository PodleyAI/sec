/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  filterTitlesSupportedBySpan,
  normalizeManagementTitle,
  normalizeManagementTitles,
  titleSupportedBySpan,
} from "./normalizeTitle";

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
    ["board member", "Director"],
    ["a Board Member", "Director"],
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
    // director nominees: a plain board nominee stays "Director Nominee"; a
    // nominee to a specific board role gets a parenthesized "(Nominee)" suffix
    ["Director nominee", "Director Nominee"],
    ["director nominee", "Director Nominee"],
    ["Chairman of the Board nominee", "Chairman of the Board of Directors (Nominee)"],
    ["Chairman of our board of directors nominee", "Chairman of the Board of Directors (Nominee)"],
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
    ["Chief Executive Officer and a director", ["Chief Executive Officer", "Director"]],
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
    // a conjunction INSIDE a single role is not a separator: splitting it would
    // fabricate roles ("Chief Legal") the person does not hold
    ["Chief Legal & Administrative Officer", ["Chief Legal & Administrative Officer"]],
    ["Head of Mergers & Acquisitions", ["Head of Mergers & Acquisitions"]],
    [
      "Executive Vice President, Research & Development",
      ["Executive Vice President", "Research & Development"],
    ],
    // ...but a conjunction joining two standalone roles still splits
    ["President and Chief Executive Officer", ["President", "Chief Executive Officer"]],
    ["Chief Financial Officer & Treasurer", ["Chief Financial Officer", "Treasurer"]],
    // de-duplication (case-insensitive)
    ["Director and director", ["Director"]],
    // a board chair already sits on the board -> a redundant bare "Director" is dropped
    ["Chairman of the Board of Directors and Director", ["Chairman of the Board of Directors"]],
    [["Chairman of the Board of Directors", "Director"], ["Chairman of the Board of Directors"]],
    ["Chairman and Director", ["Chairman of the Board of Directors"]],
    // ...but a plain officer role does NOT imply board membership, so both are kept
    ["Chief Executive Officer and Director", ["Chief Executive Officer", "Director"]],
    ["Chief Financial Officer and Director", ["Chief Financial Officer", "Director"]],
    // director nominees split and canonicalize per role
    ["Director nominee", ["Director Nominee"]],
    ["Chairman of the Board nominee", ["Chairman of the Board of Directors (Nominee)"]],
    // a seated directorship plus a nominee chair keeps both (a nominee chair is
    // not yet on the board, so the bare "Director" is NOT redundant)
    [
      "Director and Chairman of the Board nominee",
      ["Director", "Chairman of the Board of Directors (Nominee)"],
    ],
    // already-split list input is re-split/normalized defensively
    [["Chief Executive Officer and Director"], ["Chief Executive Officer", "Director"]],
    [
      ["President", "Secretary"],
      ["President", "Secretary"],
    ],
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

describe("filterTitlesSupportedBySpan", () => {
  const susanSpan =
    "Susan Whitfield-Chen, age 63, has served as a member of our Board of Directors since 2019. " +
    "Ms. Whitfield-Chen currently serves as a director of two other public companies.";
  const devinSpan =
    "Devin O'Leary, age 41, has served as our Chief Technology Officer since 2016. " +
    "Mr. O'Leary previously led engineering teams at two venture-backed software startups.";
  const marcusSpan =
    "Marcus T. Delgado, age 54, has served as our Chief Executive Officer and Chairman of the Board " +
    "since our founding in 2015.";

  it("drops a neighboring officer's title copied onto a director-only bio", () => {
    expect(
      filterTitlesSupportedBySpan(["Chief Technology Officer", "Director"], susanSpan)
    ).toEqual(["Director"]);
  });

  it("keeps a C-suite title that appears in the span", () => {
    expect(filterTitlesSupportedBySpan(["Chief Technology Officer"], devinSpan)).toEqual([
      "Chief Technology Officer",
    ]);
  });

  it("keeps a board chair when the span omits 'of Directors'", () => {
    expect(
      filterTitlesSupportedBySpan(
        ["Chief Executive Officer", "Chairman of the Board of Directors"],
        marcusSpan
      )
    ).toEqual(["Chief Executive Officer", "Chairman of the Board of Directors"]);
  });

  it("accepts a C-suite acronym in the span as evidence of the full title", () => {
    expect(
      titleSupportedBySpan("Chief Financial Officer", "Jane Doe has served as our CFO since 2020.")
    ).toBe(true);
  });

  it("keeps Director when the span only says 'board member' (no 'director' word)", () => {
    expect(
      titleSupportedBySpan(
        "Director",
        "Jane Roe has served as a board member since 2019."
      )
    ).toBe(true);
  });

  it("keeps Director when the span uses 'member of our Board' prose", () => {
    expect(
      titleSupportedBySpan(
        "Director",
        "Jane Roe has served as a member of our Board of Directors since 2019."
      )
    ).toBe(true);
  });

  it("still drops a title with no supporting prose in the span", () => {
    expect(
      titleSupportedBySpan(
        "Chief Technology Officer",
        "Jane Roe has served as a board member since 2019."
      )
    ).toBe(false);
  });

  it("leaves titles unchanged when the span is missing", () => {
    expect(filterTitlesSupportedBySpan(["Director", "Chief Executive Officer"], null)).toEqual([
      "Director",
      "Chief Executive Officer",
    ]);
    expect(filterTitlesSupportedBySpan(["Director"], "   ")).toEqual(["Director"]);
  });
});
