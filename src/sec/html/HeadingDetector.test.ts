/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { isHeadingCandidate, assignHeadingLevels } from "./HeadingDetector";
import type { ResolvedStyle } from "./types";

const style = (o: Partial<ResolvedStyle>): ResolvedStyle => ({
  fontSizePt: 10,
  bold: false,
  italic: false,
  underline: false,
  centered: false,
  upperRatio: 0,
  ...o,
});

describe("isHeadingCandidate", () => {
  it("accepts short bold + centered text", () => {
    expect(
      isHeadingCandidate("MANAGEMENT", style({ bold: true, centered: true, upperRatio: 1 }))
    ).toBe(true);
  });
  it("rejects text longer than the max heading length (length gate)", () => {
    // No terminal/mid punctuation, strongly emphasized — only the length gate can reject it.
    const tooLong = "A ".repeat(120).trim(); // ~239 chars, all caps, no sentence punctuation
    expect(isHeadingCandidate(tooLong, style({ bold: true, centered: true, upperRatio: 1 }))).toBe(
      false
    );
  });
  it("rejects a long sentence even if bold", () => {
    const long =
      "This is a long sentence that happens to be bold but is clearly running prose, not a heading.";
    expect(isHeadingCandidate(long, style({ bold: true }))).toBe(false);
  });
  it("rejects single-trait inline emphasis", () => {
    expect(isHeadingCandidate("important", style({ bold: true }))).toBe(false);
  });
  it("rejects text ending in sentence punctuation", () => {
    expect(isHeadingCandidate("We did this.", style({ bold: true, centered: true }))).toBe(false);
  });
});

describe("assignHeadingLevels", () => {
  it("maps distinct styles to levels by first appearance", () => {
    const big = style({ bold: true, fontSizePt: 16, upperRatio: 1 });
    const small = style({ bold: true, fontSizePt: 12 });
    const levels = assignHeadingLevels([big, small, big]);
    expect(levels).toEqual([1, 2, 1]);
  });
});
