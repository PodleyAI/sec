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
 * Stage B: assign a heading level (1..6) to each candidate by ranking the
 * document's distinct signatures by visual prominence — font size, then
 * all-caps, then centering, then weight. Robust to absolute font sizes varying
 * across filings (relative ordering within one document drives nesting), and —
 * unlike the previous first-appearance ordering — robust to documents with
 * many candidate styles: cover-page one-offs no longer consume the low levels
 * and force real section headings and their sub-headings onto the same capped
 * level, where a sub-heading would strip its parent's body.
 */
export function assignHeadingLevels(styles: ResolvedStyle[]): number[] {
  const sigs = styles.map(signature);
  const firstBySig = new Map<string, ResolvedStyle>();
  sigs.forEach((sig, i) => {
    if (!firstBySig.has(sig)) firstBySig.set(sig, styles[i]);
  });
  const prominence = (s: ResolvedStyle): number =>
    Math.round(s.fontSizePt) * 1000 +
    (s.upperRatio >= 0.8 ? 100 : 0) +
    (s.centered ? 10 : 0) +
    (s.bold ? 1 : 0);
  const prominenceBySig = new Map(
    [...firstBySig.entries()].map(([sig, s]) => [sig, prominence(s)])
  );
  // Distinct prominence tiers, most prominent first. Styles with equal
  // prominence share a level; with more than six tiers, adjacent tiers are
  // merged evenly rather than the tail being flattened onto level 6 — merging
  // preserves the monotone order (a more prominent style never nests deeper),
  // which is what keeps a sub-heading from closing its parent's section.
  const tiers = [...new Set(prominenceBySig.values())].sort((a, b) => b - a);
  const levelOfTier = (idx: number): number =>
    tiers.length <= 6 ? idx + 1 : Math.max(1, Math.ceil(((idx + 1) * 6) / tiers.length));
  const levelByProminence = new Map(tiers.map((p, idx) => [p, levelOfTier(idx)]));
  return sigs.map(
    (sig) => levelByProminence.get(prominenceBySig.get(sig) as number) as number
  );
}
