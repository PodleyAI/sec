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
  it("maps distinct styles to levels by prominence, not appearance order", () => {
    const big = style({ bold: true, fontSizePt: 16, upperRatio: 1 });
    const small = style({ bold: true, fontSizePt: 12 });
    // `small` appears first but the larger style still takes level 1.
    expect(assignHeadingLevels([small, big, small])).toEqual([2, 1, 2]);
    expect(assignHeadingLevels([big, small, big])).toEqual([1, 2, 1]);
  });

  it("ranks all-caps above centered above weight at equal size", () => {
    const capsBold = style({ bold: true, upperRatio: 1 });
    const centeredBold = style({ bold: true, centered: true });
    const capsCentered = style({ upperRatio: 1, centered: true });
    const levels = assignHeadingLevels([centeredBold, capsBold, capsCentered]);
    // caps+centered > caps+bold > centered+bold (title case).
    expect(levels[2]).toBeLessThan(levels[1]);
    expect(levels[1]).toBeLessThan(levels[0]);
  });

  it("preserves monotone prominence order when tiers exceed six (merges, never inverts)", () => {
    // 12 distinct sizes — more tiers than levels. Adjacent tiers may share a
    // level, but a more prominent style must never land on a deeper level:
    // that inversion is what let a sub-heading strip its parent's body.
    const styles = Array.from({ length: 12 }, (_, i) =>
      style({ bold: true, fontSizePt: 24 - i, upperRatio: 1 })
    );
    const levels = assignHeadingLevels(styles);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    }
    expect(Math.max(...levels)).toBeLessThanOrEqual(6);
    expect(Math.min(...levels)).toBe(1);
    // The spread uses the whole 1..6 range rather than piling the tail on 6.
    expect(new Set(levels).size).toBe(6);
  });

  it("gives a caps section heading a shallower level than a title-case sub-heading", () => {
    // The MANAGEMENT / "Founder, Officers, ..." shape from real 2021 S-1s:
    // both 10pt bold, one all-caps left, one title-case centered. The section
    // heading must outrank the sub-heading so its body nests beneath it.
    const section = style({ bold: true, upperRatio: 1 });
    const sub = style({ bold: true, centered: true });
    const [sectionLevel, subLevel] = assignHeadingLevels([section, sub]);
    expect(sectionLevel).toBeLessThan(subLevel);
  });
});
