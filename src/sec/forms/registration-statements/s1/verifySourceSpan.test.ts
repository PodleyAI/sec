/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  MAX_SPAN_CHARS,
  MAX_STORED_SPAN_CHARS,
  MIN_SPAN_CAP_CHARS,
  MAX_SPAN_SECTION_FRACTION,
  boundSourceSpan,
  classifySpan,
  contiguousSpanHead,
  normalizeForSpanMatch,
  spanAppearsIn,
  spanCapFor,
  verifyRowSpan,
  worstVerdict,
} from "./verifySourceSpan";

/** A section long enough that `spanCapFor` returns the absolute ceiling. */
function sectionHolding(span: string): string {
  const needed = Math.ceil(MAX_SPAN_CHARS / MAX_SPAN_SECTION_FRACTION);
  return `before... ${span} ...after`.padEnd(needed + span.length, " filler");
}

describe("normalizeForSpanMatch", () => {
  it("returns empty string for null / undefined", () => {
    expect(normalizeForSpanMatch(null)).toBe("");
    expect(normalizeForSpanMatch(undefined)).toBe("");
  });

  it("normalizes curly double-quotes to straight quotes", () => {
    expect(normalizeForSpanMatch("“Acme Sponsor LLC”")).toBe('"acme sponsor llc"');
  });

  it("normalizes curly single-quotes to straight apostrophes", () => {
    expect(normalizeForSpanMatch("‘Smith’s’")).toBe("'smith's'");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeForSpanMatch("Acme   Sponsor\n\nLLC")).toBe("acme sponsor llc");
  });

  it("lowercases", () => {
    expect(normalizeForSpanMatch("Acme Sponsor")).toBe("acme sponsor");
  });
});

describe("spanAppearsIn", () => {
  const haystack =
    "Our sponsor, Acme Sponsor LLC, is a Delaware limited liability company. " +
    "It was formed by John Smith and  Jane Doe in 2024.";

  it("returns false for empty / null / very short spans", () => {
    expect(spanAppearsIn(haystack, null)).toBe(false);
    expect(spanAppearsIn(haystack, undefined)).toBe(false);
    expect(spanAppearsIn(haystack, "")).toBe(false);
    expect(spanAppearsIn(haystack, "a")).toBe(false);
    expect(spanAppearsIn(haystack, "ab")).toBe(false);
  });

  it("returns true for exact substring match", () => {
    expect(spanAppearsIn(haystack, "Acme Sponsor LLC")).toBe(true);
  });

  it("matches across collapsed whitespace differences", () => {
    expect(spanAppearsIn(haystack, "Jane Doe")).toBe(true);
    expect(spanAppearsIn(haystack, "John   Smith")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(spanAppearsIn(haystack, "acme SPONSOR llc")).toBe(true);
  });

  it("returns false when span not present", () => {
    expect(spanAppearsIn(haystack, "Hallucinated Holdings Inc.")).toBe(false);
  });

  it("returns true when curly quotes in span match straight quotes in haystack", () => {
    const haystackQ = 'Our sponsor, "Acme Sponsor LLC", was formed in 2024.';
    expect(spanAppearsIn(haystackQ, "“Acme Sponsor LLC”")).toBe(true);
  });

  it("returns true when straight quotes in span match curly quotes in haystack", () => {
    const haystackQ = "Our sponsor, “Acme Sponsor LLC”, was formed in 2024.";
    expect(spanAppearsIn(haystackQ, '"Acme Sponsor LLC"')).toBe(true);
  });

  it("rejects spans longer than MAX_SPAN_CHARS even when verbatim-present", () => {
    // A span over the absolute ceiling that appears verbatim still fails the
    // gate — under prompt-injection a model coerced into echoing the whole
    // filer-controlled body would pass span verification trivially otherwise.
    const long = "X".repeat(MAX_SPAN_CHARS + 1);
    expect(spanAppearsIn(sectionHolding(long), long)).toBe(false);
    // Right at the ceiling passes, given a section big enough to earn it.
    const atCap = "X".repeat(MAX_SPAN_CHARS);
    expect(spanAppearsIn(sectionHolding(atCap), atCap)).toBe(true);
  });

  it("rejects a span that is too large a fraction of a small section", () => {
    // The same span that passes in a large section fails in a small one: the
    // injection risk is a span that covers the section, not its raw length.
    const span = "X".repeat(MIN_SPAN_CAP_CHARS + 1);
    expect(spanAppearsIn(sectionHolding(span), span)).toBe(true);
    expect(spanAppearsIn(`before... ${span} ...after`, span)).toBe(false);
  });
});

describe("spanCapFor", () => {
  it("never returns less than the historical flat cap", () => {
    expect(spanCapFor("")).toBe(MIN_SPAN_CAP_CHARS);
    expect(spanCapFor("x".repeat(100))).toBe(MIN_SPAN_CAP_CHARS);
    // A quarter of 2000 is 500, below the floor.
    expect(spanCapFor("x".repeat(2000))).toBe(MIN_SPAN_CAP_CHARS);
  });

  it("scales with the section and clamps at the absolute ceiling", () => {
    expect(spanCapFor("x".repeat(24_000))).toBe(6000 > MAX_SPAN_CHARS ? MAX_SPAN_CHARS : 6000);
    // The real Churchill XII Underwriting section (28,919 chars) earns the ceiling.
    expect(spanCapFor("x".repeat(28_919))).toBe(MAX_SPAN_CHARS);
  });
});

describe("classifySpan", () => {
  const haystack = "Our sponsor, Acme Sponsor LLC, is a Delaware limited liability company.";

  it("returns ok for a verbatim in-bounds span", () => {
    expect(classifySpan(haystack, "Acme Sponsor LLC")).toBe("ok");
  });

  it("returns not-found for null, too-short, and absent spans", () => {
    expect(classifySpan(haystack, null)).toBe("not-found");
    expect(classifySpan(haystack, "ab")).toBe("not-found");
    expect(classifySpan(haystack, "Hallucinated Holdings Inc.")).toBe("not-found");
  });

  it("distinguishes an over-cap span from an absent one", () => {
    // This is the whole point of the verdict: a span that IS in the text but
    // exceeds the cap must not be reported as missing from the text.
    const long = "X".repeat(MAX_SPAN_CHARS + 1);
    expect(classifySpan(sectionHolding(long), long)).toBe("too-long");
  });

  it("returns too-long for a whitespace-padded span before normalization", () => {
    const padded = "Acme Sponsor LLC" + " ".repeat(MAX_SPAN_CHARS + 1);
    expect(classifySpan(haystack, padded)).toBe("too-long");
  });
});

describe("worstVerdict", () => {
  it("is ok only when every part is ok", () => {
    expect(worstVerdict("ok", "ok")).toBe("ok");
    expect(worstVerdict("ok", "not-found")).toBe("not-found");
  });

  it("prefers too-long over not-found so the dead letter names the fixable cause", () => {
    expect(worstVerdict("not-found", "too-long")).toBe("too-long");
  });
});

describe("boundSourceSpan", () => {
  it("returns null for null / undefined", () => {
    expect(boundSourceSpan(null)).toBeNull();
    expect(boundSourceSpan(undefined)).toBeNull();
  });

  it("returns the span unchanged at exactly MAX_STORED_SPAN_CHARS", () => {
    const atCap = "a".repeat(MAX_STORED_SPAN_CHARS);
    expect(boundSourceSpan(atCap)).toBe(atCap);
  });

  it("returns null for spans exceeding MAX_STORED_SPAN_CHARS by one", () => {
    const overCap = "a".repeat(MAX_STORED_SPAN_CHARS + 1);
    expect(boundSourceSpan(overCap)).toBeNull();
  });

  it("returns short spans unchanged", () => {
    expect(boundSourceSpan("Jane Roe — Director")).toBe("Jane Roe — Director");
  });
});

describe("verifyRowSpan", () => {
  const haystack =
    "Our sponsor, Acme Sponsor LLC, is a Delaware limited liability company.";

  it("returns false for null / undefined", () => {
    expect(verifyRowSpan(haystack, null)).toBe(false);
    expect(verifyRowSpan(haystack, undefined)).toBe(false);
  });

  it("returns true for an in-bounds verbatim span", () => {
    expect(verifyRowSpan(haystack, "Acme Sponsor LLC")).toBe(true);
  });

  it("returns false at the raw-cap boundary when the raw span is too large, even if it would normalize under cap", () => {
    // A raw span padded with whitespace far above MAX_STORED_SPAN_CHARS would
    // collapse under normalization, but the storage-side cap rejects it BEFORE
    // normalization so it cannot smuggle adversarial bulk through the verifier.
    const padded = "Acme Sponsor LLC" + " ".repeat(MAX_STORED_SPAN_CHARS + 1);
    expect(padded.length).toBeGreaterThan(MAX_STORED_SPAN_CHARS);
    expect(verifyRowSpan(haystack, padded)).toBe(false);
  });

  it("returns true when the raw span is at exactly MAX_STORED_SPAN_CHARS and verbatim-present", () => {
    const atCap = "X".repeat(MAX_STORED_SPAN_CHARS);
    expect(verifyRowSpan(sectionHolding(atCap), atCap)).toBe(true);
  });

  it("returns false when the raw span is at MAX_STORED_SPAN_CHARS + 1", () => {
    const overCap = "X".repeat(MAX_STORED_SPAN_CHARS + 1);
    expect(verifyRowSpan(sectionHolding(overCap), overCap)).toBe(false);
  });
});

describe("markdown table separators", () => {
  // The exact live failure: the offering table renders a row boundary as
  // "… |\n|  | …", and the model quoting across two rows wrote "| |" where the
  // render had "| | |". Every word matched; the section was dropped anyway,
  // taking the issuer's whole ticker series with it.
  const rendered =
    "Securities offered | 30,000,000 units, at $10.00 per unit, each unit consisting of: |\n" +
    "|  | • one Class A ordinary share; and |\n" +
    "|  | • one-tenth of one warrant. |";
  const quoted =
    "Securities offered | 30,000,000 units, at $10.00 per unit, each unit consisting of: " +
    "|  | • one Class A ordinary share; and |  | • one-tenth of one warrant.";

  it("accepts a span that crosses a table row boundary", () => {
    expect(classifySpan(rendered, quoted)).toBe("ok");
  });

  it("still requires the words themselves to match", () => {
    const wrong = quoted.replace("30,000,000", "40,000,000");
    expect(classifySpan(rendered, wrong)).toBe("not-found");
  });

  it("does not let pipe-fuzzing bridge genuinely different text", () => {
    expect(classifySpan(rendered, "one Class A ordinary share; and one-tenth of one bicycle")).toBe(
      "not-found"
    );
  });

  it("keeps a single-row table cell quote working", () => {
    expect(classifySpan("| ACME Fund | 1,000,000 | 12.5% |", "| ACME Fund | 1,000,000 | 12.5% |")).toBe(
      "ok"
    );
  });
});

describe("elided spans", () => {
  // The live case: sponsor-promote returns ONE span for seven figures scattered
  // across a long table, so the model stitched rows together with "..." — and
  // kept doing it after the prompt explicitly forbade it. Rejecting outright
  // cost all seven correct figures on every run.
  const section =
    "| Securities offered | 30,000,000 units, at $10.00 per unit |\n" +
    "| Number outstanding before this offering | 11,500,000 Class B ordinary shares |\n" +
    "| Founder shares | 25% of post-IPO shares |";

  it("keeps the verbatim head and accepts the row", () => {
    const elided =
      "| Securities offered | 30,000,000 units, at $10.00 per unit |\n...\n" +
      "| Founder shares | 25% of post-IPO shares |";
    expect(classifySpan(section, elided)).toBe("ok");
  });

  it("stores the head only — never the stitched construction", () => {
    const elided = "| Securities offered | 30,000,000 units, at $10.00 per unit |\n...\nmore";
    const stored = boundSourceSpan(elided);
    expect(stored).not.toContain("...");
    expect(section).toContain(stored!.trim());
  });

  it("rejects an elision whose head proves nothing", () => {
    // A token head followed by "..." is not evidence the model read anything.
    expect(classifySpan(section, "| Sec...everything else invented")).toBe("not-found");
  });

  it("still rejects an elided span whose head is not in the document", () => {
    expect(
      classifySpan(section, "| Securities offered | 99,999,999 units, at $99.00 per unit |\n...\nx")
    ).toBe("not-found");
  });

  it("leaves an ordinary span untouched", () => {
    expect(contiguousSpanHead("no markers here")).toBe("no markers here");
  });
});
