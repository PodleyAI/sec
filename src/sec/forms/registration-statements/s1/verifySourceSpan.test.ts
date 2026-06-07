/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { normalizeForSpanMatch, spanAppearsIn } from "./verifySourceSpan";

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
});
