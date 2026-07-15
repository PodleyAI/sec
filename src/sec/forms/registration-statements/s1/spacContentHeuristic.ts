/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strong blank-check / SPAC signal phrases. A genuine SPAC prospectus repeats
 * this vocabulary densely; an ordinary operating company that merely mentions a
 * "business combination" once in a risk factor does not. Matching is
 * case-insensitive and whitespace-insensitive (the prose is rendered from HTML,
 * so runs of whitespace vary).
 */
const BLANK_CHECK_SIGNALS: readonly RegExp[] = [
  /blank[\s-]*check/i,
  /special[\s-]+purpose[\s-]+acquisition/i,
  /initial[\s-]+business[\s-]+combination/i,
  /trust[\s-]+account/i,
  /redeem[\w]*\s+(?:their|its|the)?\s*public[\s-]+shares/i,
  /founder[\s-]+shares/i,
  /our[\s-]+sponsor/i,
];

/**
 * Cheap deterministic pre-filter that decides whether a registration filing's
 * prose is SPAC-like enough to be worth an AI content-classification call. Only
 * used for filings the deterministic SIC path did NOT already classify as a SPAC
 * (SIC ≠ 6770), so the AI call stays rare — reserved for plausibly miscoded
 * filings rather than every S-1. Requires at least `minSignals` DISTINCT strong
 * blank-check signals so a single stray "business combination" in an operating
 * company's risk factors does not trip it.
 */
export function looksLikeBlankCheck(text: string, minSignals = 2): boolean {
  if (!text) return false;
  let hits = 0;
  for (const re of BLANK_CHECK_SIGNALS) {
    if (re.test(text)) {
      hits += 1;
      if (hits >= minSignals) return true;
    }
  }
  return false;
}
