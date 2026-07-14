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
    // matched Jane (name ok, title wrong) → 1 of 4 expected field-values
    expect(s.score).toBeCloseTo(0.25, 5);
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

  it("aligns single-object extractors by position", () => {
    const s = scoreExtraction(
      [{ ipo_amount: 250_000_000, share_price: "10.00" }],
      [{ ipo_amount: 250000000, share_price: "10.00" }]
    );
    expect(s.score).toBe(1);
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
      const candidate = [{ full_name: "Jane Smith", titles: ["director", "chief executive officer"] }];
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
      // full_name (1) + 1 of 2 roles = 2 of 3
      expect(s.score).toBeCloseTo(2 / 3, 5);
      expect(s.diff.mismatches).toEqual([
        {
          key: "Jane Smith",
          field: "titles",
          expected: '["Chief Executive Officer", "Director"]',
          got: '["Chief Executive Officer"]',
        },
      ]);
    });

    it("flags an extra role the candidate invented", () => {
      const candidate = [
        { full_name: "Jane Smith", titles: ["Chief Executive Officer", "Director", "Founder"] },
      ];
      const s = scoreExtraction(candidate, rolesExpected, {
        keyField: "full_name",
        fields: ["full_name", "titles"],
      });
      // all expected roles found (score 1), but the extra role is surfaced in the diff
      expect(s.score).toBe(1);
      expect(s.diff.mismatches).toHaveLength(1);
      expect(s.diff.mismatches[0]?.got).toBe(
        '["Chief Executive Officer", "Director", "Founder"]'
      );
    });
  });
});
