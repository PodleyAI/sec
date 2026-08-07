/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { fingerprintRows } from "./fingerprintRows";
import { summarizeStability, type FixtureRunResult } from "./runExtractionEval";

const row = (name: string, span: string, confidence = 0.9) => ({
  full_name: name,
  titles: ["Director"],
  source_span: span,
  confidence,
});

describe("fingerprintRows", () => {
  it("ignores row order — the same people in a different sequence is not a change", () => {
    const a = [row("Jane Roe", "Jane"), row("John Doe", "John")];
    const b = [row("John Doe", "John"), row("Jane Roe", "Jane")];
    expect(fingerprintRows(a)).toBe(fingerprintRows(b));
  });

  it("ignores key order", () => {
    const a = [{ full_name: "Jane Roe", confidence: 0.9 }];
    const b = [{ confidence: 0.9, full_name: "Jane Roe" }];
    expect(fingerprintRows(a)).toBe(fingerprintRows(b));
  });

  it("separates a citation difference from a content difference", () => {
    // The live pattern: same risk found, caption cut at a different point.
    const short = [row("Jane Roe", "Jane Roe is a Director.")];
    const long = [row("Jane Roe", "Jane Roe is a Director. She joined in 2020.")];
    expect(fingerprintRows(short, true)).not.toBe(fingerprintRows(long, true));
    expect(fingerprintRows(short, false)).toBe(fingerprintRows(long, false));
  });

  it("treats a genuinely different extraction as different under both", () => {
    const a = [row("Jane Roe", "Jane")];
    const b = [row("Someone Else", "Jane")];
    expect(fingerprintRows(a, true)).not.toBe(fingerprintRows(b, true));
    expect(fingerprintRows(a, false)).not.toBe(fingerprintRows(b, false));
  });

  it("produces the same digest under a different collation", () => {
    // `localeCompare` sorts by the runtime's ICU collation, so the same rows
    // would digest differently on two differently-configured machines and a
    // stability report compared across them would show disagreement that is not
    // there. Standing in a different collation must not move the digest.
    const rows = [row("Jane Roe", "Jane"), { Alpha: 1, alpha: 2, beta: 3, Beta: 4 }];
    const expected = fingerprintRows(rows);

    const original = String.prototype.localeCompare;
    // eslint-disable-next-line no-extend-native
    String.prototype.localeCompare = function reversed(this: string, that: string): number {
      return original.call(that, this);
    };
    try {
      expect(fingerprintRows(rows)).toBe(expected);
    } finally {
      // eslint-disable-next-line no-extend-native
      String.prototype.localeCompare = original;
    }
  });

  it("does not collapse a confidence drift into the content digest", () => {
    const a = [row("Jane Roe", "Jane", 0.9)];
    const b = [row("Jane Roe", "Jane", 0.7)];
    expect(fingerprintRows(a, false)).toBe(fingerprintRows(b, false));
  });
});

const result = (
  model: string,
  fixture: string,
  run: number,
  fingerprint: string,
  contentFingerprint: string
): FixtureRunResult =>
  ({
    model,
    fixture,
    extractor: "management",
    ok: true,
    error: undefined,
    latencyMs: 1,
    rows: 1,
    score: { score: 1 } as never,
    cost: {} as never,
    run,
    fingerprint,
    contentFingerprint,
  }) as FixtureRunResult;

describe("summarizeStability", () => {
  it("counts a fixture stable only when every run agrees", () => {
    const [summary] = summarizeStability(
      [
        result("m", "f1", 1, "a", "A"),
        result("m", "f1", 2, "a", "A"),
        result("m", "f2", 1, "b", "B"),
        result("m", "f2", 2, "c", "B"),
      ],
      2
    );
    expect(summary.fixtures).toBe(2);
    // f1 agreed on both; f2 differed on citations but agreed on facts.
    expect(summary.stableExact).toBe(1);
    expect(summary.stableContent).toBe(2);
  });

  it("reports each model separately", () => {
    const summaries = summarizeStability(
      [
        result("a", "f1", 1, "x", "X"),
        result("a", "f1", 2, "x", "X"),
        result("b", "f1", 1, "y", "Y"),
        result("b", "f1", 2, "z", "Z"),
      ],
      2
    );
    expect(summaries.find((s) => s.model === "a")?.stableExact).toBe(1);
    expect(summaries.find((s) => s.model === "b")?.stableExact).toBe(0);
    expect(summaries.find((s) => s.model === "b")?.stableContent).toBe(0);
  });

  it("does not count two failed runs as reproducible agreement", () => {
    // Both runs failed; the sentinel fingerprints differ per run on purpose so
    // "we consistently produced nothing" is not reported as stability.
    const summaries = summarizeStability(
      [result("m", "f1", 1, "error:1", "error:1"), result("m", "f1", 2, "error:2", "error:2")],
      2
    );
    expect(summaries[0].stableExact).toBe(0);
  });
});
