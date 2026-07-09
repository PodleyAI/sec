/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  MAX_SPAN_CHARS,
  MAX_STORED_SPAN_CHARS,
  boundSourceSpan,
  normalizeForSpanMatch,
  spanAppearsIn,
  verifyRowSpan,
} from "./verifySourceSpan";

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
    // A 1001-char span that appears verbatim in the haystack still fails the
    // gate — under prompt-injection a model coerced into echoing the whole
    // filer-controlled body would pass span verification trivially otherwise.
    const long = "X".repeat(MAX_SPAN_CHARS + 1);
    expect(long.length).toBe(1001);
    const haystackLong = `before... ${long} ...after`;
    expect(spanAppearsIn(haystackLong, long)).toBe(false);
    // Right at the cap still passes (the cap is inclusive of MAX_SPAN_CHARS).
    const atCap = "X".repeat(MAX_SPAN_CHARS);
    const haystackAtCap = `before... ${atCap} ...after`;
    expect(spanAppearsIn(haystackAtCap, atCap)).toBe(true);
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
    const haystackAtCap = `before... ${atCap} ...after`;
    expect(verifyRowSpan(haystackAtCap, atCap)).toBe(true);
  });

  it("returns false when the raw span is at MAX_STORED_SPAN_CHARS + 1", () => {
    const overCap = "X".repeat(MAX_STORED_SPAN_CHARS + 1);
    const haystackOverCap = `before... ${overCap} ...after`;
    expect(verifyRowSpan(haystackOverCap, overCap)).toBe(false);
  });
});
