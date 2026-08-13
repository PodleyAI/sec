/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cut section prose at the earliest whole-line stop heading after
 * `floorRatio` of the text. Optionally also enforce `maxChars` (preferring a
 * paragraph break near the cap). Returns `text` unchanged when neither applies.
 */
export function trimSectionAtStopHeadings(
  text: string,
  stopHeadingPatterns: readonly RegExp[],
  floorRatio: number,
  maxChars: number | undefined = undefined
): string {
  if (text.length === 0) return text;
  const floor = Math.floor(text.length * floorRatio);
  let cut: number | undefined;
  for (const pattern of stopHeadingPatterns) {
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
    );
    for (const match of text.matchAll(re)) {
      const idx = match.index ?? -1;
      if (idx > floor && (cut === undefined || idx < cut)) {
        cut = idx;
      }
    }
  }
  if (maxChars !== undefined && text.length > maxChars) {
    let capped = maxChars;
    const breakAt = text.lastIndexOf("\n\n", maxChars);
    if (breakAt > Math.floor(maxChars * 0.7)) {
      capped = breakAt;
    }
    if (cut === undefined || capped < cut) {
      cut = capped;
    }
  }
  if (cut === undefined) return text;
  return text.slice(0, cut).replace(/\s+$/u, "");
}
