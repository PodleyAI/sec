/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parse a financial cell into a number, or undefined if it is not numeric.
 * Handles `$`, thousands separators, trailing `%`, and accounting parentheses
 * (which denote negatives). A bare em/en dash or text returns undefined.
 */
export function parseNumeric(raw: string): number | undefined {
  const t = raw.trim();
  if (t.length === 0) return undefined;
  const negative = /^\$?\(.*\)$/.test(t);
  const cleaned = t
    .replace(/[()]/g, "")
    .replace(/[$,%\s]/g, "")
    .replace(/—|–/g, ""); // em/en dash
  if (cleaned.length === 0) return undefined;
  if (!/^[+-]?\d*\.?\d+$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return undefined;
  return negative ? -value : value;
}
