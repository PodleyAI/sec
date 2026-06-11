/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal inline-XBRL transformation registry (ixt / ixt-sec) covering the
 * transforms SEC filings actually apply to facts this pipeline consumes.
 * Unknown transforms return null so callers keep the raw text and record the
 * format for later post-processing.
 */

/** Ballot-box glyphs used by ixt-sec:boolballotbox (checked => "true"). */
const BALLOT_CHECKED = /[☑☒]/; // ☑ ☒
const BALLOT_UNCHECKED = /☐/; // ☐

function numDotDecimal(text: string): string {
  // "1,234,567.89" -> "1234567.89"; also tolerates space/non-breaking-space grouping
  return text.replace(/[,\s  ]/g, "");
}

function numCommaDecimal(text: string): string {
  // "1.234.567,89" -> "1234567.89"
  return text.replace(/[.\s  ]/g, "").replace(/,/g, ".");
}

const TRANSFORMS: Record<string, (text: string) => string> = {
  "num-dot-decimal": numDotDecimal,
  numdotdecimal: numDotDecimal,
  "num-comma-decimal": numCommaDecimal,
  numcommadecimal: numCommaDecimal,
  "zero-dash": () => "0",
  zerodash: () => "0",
  "fixed-zero": () => "0",
  "fixed-empty": () => "",
  nocontent: () => "",
  "fixed-true": () => "true",
  "fixed-false": () => "false",
  booleantrue: () => "true",
  booleanfalse: () => "false",
  boolballotbox: (text) =>
    BALLOT_CHECKED.test(text) ? "true" : BALLOT_UNCHECKED.test(text) ? "false" : text.trim(),
};

/**
 * Applies a registered ixt/ixt-sec transform (matched by local name, prefix
 * ignored) to trimmed text. Returns null when the transform is not registered.
 */
export function applyIxtTransform(format: string | null, text: string): string | null {
  const trimmed = text.trim();
  if (format === null || format.length === 0) return trimmed;
  const local = format.includes(":") ? format.slice(format.indexOf(":") + 1) : format;
  const fn = TRANSFORMS[local.toLowerCase()];
  return fn ? fn(trimmed) : null;
}
