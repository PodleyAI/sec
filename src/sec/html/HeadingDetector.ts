/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ResolvedStyle } from "./types";
import { emphasisTraitCount } from "./StyleResolver";

const MAX_HEADING_LEN = 200;

/** Stage A gate: is this block a heading at all? Short + >= 2 emphasis traits. */
export function isHeadingCandidate(text: string, style: ResolvedStyle): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_HEADING_LEN) return false;
  // Sentence-ending punctuation at the end signals prose, not a heading.
  if (/[.;:]$/.test(t)) return false;
  // Mid-text sentence punctuation followed by more words also signals prose.
  if (/[.?!]\s+\S/.test(t)) return false;
  return emphasisTraitCount(style) >= 2;
}

/** A stable signature for ranking: size bucket + weight + alignment + caps. */
function signature(s: ResolvedStyle): string {
  const sizeBucket = Math.round(s.fontSizePt);
  return `${sizeBucket}|${s.bold ? "b" : "n"}|${s.centered ? "c" : "l"}|${s.upperRatio >= 0.8 ? "u" : "m"}`;
}

/**
 * Stage B: assign a heading level (1..6) to each candidate by first-appearance
 * style ordering. The first distinct signature seen becomes level 1, the next
 * new one level 2, etc. (capped at 6). Robust to absolute font sizes varying
 * across filings — relative ordering within one document drives nesting.
 */
export function assignHeadingLevels(styles: ResolvedStyle[]): number[] {
  const rankBySig = new Map<string, number>();
  let nextRank = 1;
  return styles.map((s) => {
    const sig = signature(s);
    let rank = rankBySig.get(sig);
    if (rank === undefined) {
      rank = nextRank++;
      rankBySig.set(sig, rank);
    }
    return Math.min(6, rank);
  });
}
