/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { scoreExtraction } from "./scoreExtraction";

describe("scoreExtraction", () => {
  const expected = [
    { full_name: "Jane Smith", title: "Chief Executive Officer" },
    { full_name: "John Doe", title: "Chief Financial Officer" },
  ];

  it("scores a perfect, noise-tolerant match as 1", () => {
    const candidate = [
      // extra provenance fields are ignored; whitespace/case normalized
      {
        full_name: "JANE  SMITH",
        title: "Chief Executive Officer",
        confidence: 0.9,
        source_span: "…",
      },
      { full_name: "John Doe", title: "chief financial officer", confidence: 0.8 },
    ];
    const s = scoreExtraction(candidate, expected, { keyField: "full_name" });
    expect(s.score).toBe(1);
    expect(s.entityRecall).toBe(1);
    expect(s.precision).toBe(1);
  });

  it("penalizes a missed row and a wrong field", () => {
    const candidate = [{ full_name: "Jane Smith", title: "CEO" }]; // title wrong, John missing
    const s = scoreExtraction(candidate, expected, { keyField: "full_name" });
    // F1 over field-values: matched 1 (Jane's name), expected 4, candidate
    // produced 2 (name + a wrong title) → 2·1/(4+2)
    expect(s.score).toBeCloseTo(1 / 3, 5);
    expect(s.entityRecall).toBe(0.5);
    expect(s.precision).toBe(1);
  });

  it("drops precision when the model invents an extra row", () => {
    const candidate = [
      { full_name: "Jane Smith", title: "Chief Executive Officer" },
      { full_name: "John Doe", title: "Chief Financial Officer" },
      { full_name: "Nobody Real", title: "Ghost" },
    ];
    const s = scoreExtraction(candidate, expected, { keyField: "full_name" });
    expect(s.score).toBe(1); // all expected values found
    expect(s.precision).toBeCloseTo(2 / 3, 5); // 1 spurious row
  });

  it("does not penalize precision for duplicate rows of the same entity", () => {
    const candidate = [
      { full_name: "Jane Smith", title: "Chief Executive Officer" },
      { full_name: "John Doe", title: "Chief Financial Officer" },
      // duplicates (case/whitespace variants) of already-listed people
      { full_name: "jane  smith", title: "Chief Executive Officer" },
      { full_name: "JOHN DOE", title: "Chief Financial Officer" },
    ];
    const s = scoreExtraction(candidate, expected, { keyField: "full_name" });
    expect(s.candidateItems).toBe(4);
    expect(s.candidateDistinct).toBe(2);
    expect(s.precision).toBe(1); // 2 matched / 2 distinct, not 2/4
  });

  it("still penalizes precision for distinct hallucinated rows, counting dupes once", () => {
    const candidate = [
      { full_name: "Jane Smith", title: "Chief Executive Officer" },
      { full_name: "John Doe", title: "Chief Financial Officer" },
      { full_name: "Jane Smith", title: "Chief Executive Officer" }, // dupe → ignored
      { full_name: "Ghost One", title: "x" }, // distinct hallucination
      { full_name: "Ghost Two", title: "y" }, // distinct hallucination
    ];
    const s = scoreExtraction(candidate, expected, { keyField: "full_name" });
    expect(s.candidateDistinct).toBe(4); // Jane, John, Ghost One, Ghost Two
    expect(s.precision).toBeCloseTo(2 / 4, 5);
  });

  it("collapses duplicate reference rows so recall is over distinct entities", () => {
    const dupExpected = [
      { full_name: "Jane Smith", title: "Chief Executive Officer" },
      { full_name: "Jane Smith", title: "Chief Executive Officer" }, // reference repeated
      { full_name: "John Doe", title: "Chief Financial Officer" },
    ];
    const candidate = [
      { full_name: "Jane Smith", title: "Chief Executive Officer" },
      { full_name: "John Doe", title: "Chief Financial Officer" },
    ];
    const s = scoreExtraction(candidate, dupExpected, { keyField: "full_name" });
    expect(s.expectedItems).toBe(2); // distinct reference entities
    expect(s.entityRecall).toBe(1);
    expect(s.precision).toBe(1);
  });

  it("aligns names that differ only by a curly vs straight apostrophe", () => {
    // Reference uses the typographic apostrophe (U+2019); candidate the ASCII
    // one (U+0027). Same person — must align, not count as missing + extra.
    const ref = [{ full_name: "Frank D’Angelo", titles: ["Director"] }];
    const cand = [{ full_name: "Frank D'Angelo", titles: ["Director"] }];
    const s = scoreExtraction(cand, ref, {
      keyField: "full_name",
      fields: ["full_name", "titles"],
    });
    expect(s.diff.missing).toEqual([]);
    expect(s.diff.extra).toEqual([]);
    expect(s.entityRecall).toBe(1);
    expect(s.score).toBe(1);
  });

  it("aligns names differing only by a comma before the suffix", () => {
    const ref = [{ full_name: "Frank Martire, III", titles: ["Director"] }];
    const cand = [{ full_name: "Frank Martire III", titles: ["Director"] }];
    const s = scoreExtraction(cand, ref, {
      keyField: "full_name",
      fields: ["full_name", "titles"],
    });
    expect(s.diff.missing).toEqual([]);
    expect(s.diff.extra).toEqual([]);
    expect(s.score).toBe(1);
  });

  it("aligns names differing by initial/suffix periods, but keeps decimals distinct", () => {
    const ref = [{ full_name: "Richard J. Boyle, Jr." }];
    const cand = [{ full_name: "Richard J Boyle Jr" }];
    const s = scoreExtraction(cand, ref, { keyField: "full_name" });
    expect(s.entityRecall).toBe(1);
    // A period between digits is a decimal, not punctuation — "10.00" ≠ "1000".
    const prices = scoreExtraction([{ share_price: "1000" }], [{ share_price: "10.00" }]);
    expect(prices.score).toBe(0);
  });

  it("aligns single-object extractors by position", () => {
    const s = scoreExtraction(
      [{ ipo_amount: 250_000_000, share_price: "10.00" }],
      [{ ipo_amount: 250000000, share_price: "10.00" }]
    );
    expect(s.score).toBe(1);
  });

  describe("numeric fields", () => {
    it("accepts a fuller-precision candidate for a rounded reference ratio", () => {
      // 1/3 written out in full is the same warrant coverage as a golden 0.3333.
      const s = scoreExtraction(
        [{ public_warrant_coverage: 0.3333333333 }],
        [{ public_warrant_coverage: 0.3333 }]
      );
      expect(s.score).toBe(1);
      expect(s.diff.mismatches).toEqual([]);
    });

    it("ignores trailing-zero and integer/decimal formatting differences", () => {
      const s = scoreExtraction(
        [{ trust_per_public_share: "10.20", founder_shares: "6,250,000" }],
        [{ trust_per_public_share: 10.2, founder_shares: 6250000 }]
      );
      expect(s.score).toBe(1);
    });

    it("still flags a value that differs at the reference's own precision", () => {
      const s = scoreExtraction(
        [{ public_warrant_coverage: 0.3339, trust_per_public_share: 10 }],
        [{ public_warrant_coverage: 0.3333, trust_per_public_share: 10.2 }]
      );
      expect(s.score).toBe(0);
      expect(s.diff.mismatches.map((m) => m.field)).toEqual([
        "public_warrant_coverage",
        "trust_per_public_share",
      ]);
    });
  });

  it("treats an empty candidate against non-empty expected as zero", () => {
    const s = scoreExtraction([], expected, { keyField: "full_name" });
    expect(s.score).toBe(0);
    expect(s.entityRecall).toBe(0);
    expect(s.precision).toBe(0);
  });

  it("captures the concrete missing / extra / field-mismatch diff", () => {
    const candidate = [
      { full_name: "Jane Smith", title: "CEO" }, // title mismatch
      { full_name: "Nobody Real", title: "Ghost" }, // extra / hallucinated
      // John Doe absent → missing
    ];
    const s = scoreExtraction(candidate, expected, { keyField: "full_name" });
    expect(s.diff.missing).toEqual(["John Doe"]);
    expect(s.diff.extra).toEqual(["Nobody Real"]);
    expect(s.diff.mismatches).toEqual([
      {
        key: "Jane Smith",
        field: "title",
        expected: "Chief Executive Officer",
        got: "CEO",
      },
    ]);
  });

  it("reports raw (un-normalized) values and a clean diff on a perfect match", () => {
    const candidate = [
      { full_name: "JANE  SMITH", title: "Chief Executive Officer" },
      { full_name: "John Doe", title: "chief financial officer" },
    ];
    const s = scoreExtraction(candidate, expected, { keyField: "full_name" });
    expect(s.diff).toEqual({ missing: [], extra: [], mismatches: [] });
  });

  describe("multi-valued (array) fields", () => {
    // A person's `titles` is a role list scored per element: each expected role
    // is a unit, and the candidate is credited the intersection.
    const rolesExpected = [
      { full_name: "Jane Smith", titles: ["Chief Executive Officer", "Director"] },
    ];

    it("gives full credit when every role matches (order/case-insensitive)", () => {
      const candidate = [
        { full_name: "Jane Smith", titles: ["director", "chief executive officer"] },
      ];
      const s = scoreExtraction(candidate, rolesExpected, {
        keyField: "full_name",
        fields: ["full_name", "titles"],
      });
      // full_name (1) + 2 roles = 3 of 3 field-values
      expect(s.score).toBe(1);
      expect(s.diff.mismatches).toEqual([]);
    });

    it("gives partial credit when the candidate finds only some roles", () => {
      const candidate = [{ full_name: "Jane Smith", titles: ["Chief Executive Officer"] }];
      const s = scoreExtraction(candidate, rolesExpected, {
        keyField: "full_name",
        fields: ["full_name", "titles"],
      });
      // F1: matched 2 (name + CEO), expected 3, candidate produced 2 → 2·2/(3+2)
      expect(s.score).toBeCloseTo(0.8, 5);
      expect(s.diff.mismatches).toEqual([
        {
          key: "Jane Smith",
          field: "titles",
          expected: '["Chief Executive Officer", "Director"]',
          got: '["Chief Executive Officer"]',
        },
      ]);
    });

    it("lowers the score for an invented (over-produced) role", () => {
      const candidate = [
        { full_name: "Jane Smith", titles: ["Chief Executive Officer", "Director", "Founder"] },
      ];
      const s = scoreExtraction(candidate, rolesExpected, {
        keyField: "full_name",
        fields: ["full_name", "titles"],
      });
      // every expected role is found, but the made-up "Founder" is over-production:
      // matched 3, expected 3, candidate produced 4 → F1 2·3/(3+4) < 1
      expect(s.score).toBeCloseTo(6 / 7, 5);
      expect(s.diff.mismatches).toHaveLength(1);
      expect(s.diff.mismatches[0]?.got).toBe('["Chief Executive Officer", "Director", "Founder"]');
    });
  });

  describe("fields the reference leaves empty", () => {
    // `compareFields` is a fixed list, so on any given section some fields are
    // null in the reference (e.g. the SPAC-only unit terms on an ordinary equity
    // offering). Such a field states nothing to find: it must neither earn credit
    // nor push `score` — an F1 — above 1.
    const fields = ["price", "warrant_fraction", "trust_per_unit"];
    const expected = [{ price: 10, warrant_fraction: null, trust_per_unit: null }];

    it("scores an exactly-agreeing candidate at 1, not above it", () => {
      const s = scoreExtraction(
        [{ price: 10, warrant_fraction: null, trust_per_unit: null }],
        expected,
        {
          keyField: "price",
          fields,
        }
      );
      expect(s.score).toBeCloseTo(1, 5);
    });

    it("penalizes a candidate that invents a value the reference does not state", () => {
      const s = scoreExtraction(
        [{ price: 10, warrant_fraction: 0.5, trust_per_unit: null }],
        expected,
        {
          keyField: "price",
          fields,
        }
      );
      // matched 1 (price), expected 1, candidate produced 2 → 2·1/(1+2)
      expect(s.score).toBeCloseTo(2 / 3, 5);
    });

    it("does not reward a candidate for leaving every field empty", () => {
      const s = scoreExtraction(
        [{ price: null, warrant_fraction: null, trust_per_unit: null }],
        expected,
        {
          fields,
        }
      );
      expect(s.score).toBeCloseTo(0, 5);
    });
  });

  describe("personNameFields", () => {
    // The flag exists because a filing's roster and its bio prose disagree about
    // credentials. Alignment must survive that; it must NOT survive being pointed
    // at a field that can hold an organization.
    const roster = [{ full_name: "Isaac Manke", titles: ["Director"] }];

    it("aligns a credentialed variant to the same person and scores it 1.0", () => {
      const s = scoreExtraction(
        [{ full_name: "Isaac Manke, Ph.D.", titles: ["Director"] }],
        roster,
        {
          keyField: "full_name",
          fields: ["full_name", "titles"],
          personNameFields: ["full_name"],
        }
      );
      expect(s.matchedItems).toBe(1);
      expect(s.entityRecall).toBe(1);
      expect(s.score).toBeCloseTo(1, 5);
      expect(s.diff.missing).toEqual([]);
      expect(s.diff.mismatches).toEqual([]);
    });

    it("without the flag, the same pair does not align", () => {
      // Establishes that the case above is measuring the flag and not normalize()
      // already folding the credential away.
      const s = scoreExtraction(
        [{ full_name: "Isaac Manke, Ph.D.", titles: ["Director"] }],
        roster,
        {
          keyField: "full_name",
          fields: ["full_name", "titles"],
        }
      );
      expect(s.matchedItems).toBe(0);
    });

    it("keeps two entities of one fund family DISTINCT under plain normalization", () => {
      // Guards the beneficial-ownership decision: an ownership `name` is a person
      // OR an entity, and the person hash reads a legal-form suffix as a
      // credential — "WAVE Equity Fund, L.P." and "WAVE Equity Fund, LLC" both
      // hash to `wave-equity-fund`. This test fails the moment anyone re-adds
      // personNameFields to an entity-bearing name field.
      const owners = [{ name: "WAVE Equity Fund, L.P." }, { name: "WAVE Equity Fund, LLC" }];
      const s = scoreExtraction(owners, owners, { keyField: "name", fields: ["name"] });
      expect(s.candidateDistinct).toBe(2);
      expect(s.expectedItems).toBe(2);
      expect(s.matchedItems).toBe(2);
      expect(s.precision).toBe(1);
    });

    it("would collapse those two entities into one row if the field were flagged", () => {
      // The failure this fix removes, stated directly: one of the two funds is
      // reported missing and the other absorbs it, so a model that correctly
      // listed both is scored as having found one.
      const owners = [{ name: "WAVE Equity Fund, L.P." }, { name: "WAVE Equity Fund, LLC" }];
      const s = scoreExtraction(owners, owners, {
        keyField: "name",
        fields: ["name"],
        personNameFields: ["name"],
      });
      expect(s.candidateDistinct).toBe(1);
      expect(s.expectedItems).toBe(1);
    });
    it("scores a mixed name column through the row's own owner_kind", () => {
      // The whole point of the per-row dispatch, in one table: the two funds
      // must stay distinct (person hashing merges them) AND the person must
      // align across a credential (company hashing splits them). No single
      // parser satisfies both, which is why the row decides.
      const expected = [
        { name: "WAVE Equity Fund, L.P.", owner_kind: "company" },
        { name: "WAVE Equity Fund, LLC", owner_kind: "company" },
        { name: "Isaac Manke", owner_kind: "person" },
      ];
      const candidate = [
        { name: "WAVE Equity Fund, L.P.", owner_kind: "company" },
        { name: "WAVE Equity Fund, LLC", owner_kind: "company" },
        { name: "Isaac Manke, Ph.D.", owner_kind: "person" },
      ];
      const s = scoreExtraction(candidate, expected, {
        keyField: "name",
        fields: ["name"],
        entityNameFields: ["name"],
        entityKindField: "owner_kind",
      });
      expect(s.candidateDistinct).toBe(3);
      expect(s.expectedItems).toBe(3);
      expect(s.matchedItems).toBe(3);
      expect(s.entityRecall).toBe(1);
      expect(s.precision).toBe(1);
    });

    it("falls back to plain normalization when the discriminator is absent or unknown", () => {
      // Never guess a parser: each one corrupts identity in a different
      // direction, and plain normalization only costs alignment it could have
      // had. Two funds with no owner_kind stay two rows.
      const owners = [
        { name: "WAVE Equity Fund, L.P." },
        { name: "WAVE Equity Fund, LLC" },
        { name: "Someone Else", owner_kind: "trust" },
      ];
      const s = scoreExtraction(owners, owners, {
        keyField: "name",
        fields: ["name"],
        entityNameFields: ["name"],
        entityKindField: "owner_kind",
      });
      expect(s.candidateDistinct).toBe(3);
      expect(s.matchedItems).toBe(3);
    });

    it("aligns an organization across a legal-form spelling via companyNameFields", () => {
      const s = scoreExtraction(
        [{ name: "WAVE Equity Fund LP" }],
        [{ name: "WAVE Equity Fund, L.P." }],
        { keyField: "name", fields: ["name"], companyNameFields: ["name"] }
      );
      expect(s.matchedItems).toBe(1);
      expect(s.entityRecall).toBe(1);
    });
  });
});
