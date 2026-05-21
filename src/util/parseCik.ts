/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Coerce a CIK-shaped string or number into a non-negative integer.
 *
 * EDGAR occasionally emits non-digit cruft (whitespace, stray punctuation,
 * leading zeros) in CIK fields. `parseInt` would silently turn "123abc"
 * into 123, which is a plausible-but-wrong CIK; this helper rejects any
 * input that isn't all digits and returns 0 for missing/invalid values.
 */
export function parseCikSafely(raw: string | number | undefined | null): number {
  if (raw === undefined || raw === null) return 0;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
}
