/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

export const OFFERING_TRIM_FLOOR_RATIO = 0.08;

/** Soft ceiling when The Offering absorbs later prospectus chapters. */
export const OFFERING_TRIM_MAX_CHARS = 80_000;

/**
 * Offering-terms only needs the early unit/price table. Cap tighter than the
 * general offering trim so long warrant/redemption chapters do not blow the
 * schema-constrained JSON response (tickers / confidence / source_span).
 */
export const OFFERING_TERMS_TRIM_MAX_CHARS = 50_000;

const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*Summary of (?:the )?Risk Factors\s*$/im,
  /^\s*Risk Factors\s*$/im,
  /^\s*Use of Proceeds\s*$/im,
  /^\s*Dividend(?:s)? Policy\s*$/im,
  /^\s*Capitalization\s*$/im,
  /^\s*Dilution\s*$/im,
  /^\s*Underwriting(?:\s*\(.*\))?\s*$/im,
  /^\s*Description of (?:Our )?(?:Capital Stock|Securities|Units|Warrants|Ordinary Shares)\s*$/im,
  /^\s*Shares Eligible for Future Sale\s*$/im,
  /^\s*Material (?:U\.?S\.? )?Federal Income Tax\b.*$/im,
  /^\s*Legal Matters\s*$/im,
];

/**
 * Trim The Offering section for offering-terms and sponsor-promote: keep the
 * deal/unit table prose; drop later chapters the segmenter sometimes absorbs.
 */
export function trimOfferingSectionText(text: string): string {
  return trimSectionAtStopHeadings(
    text,
    STOP_HEADING_PATTERNS,
    OFFERING_TRIM_FLOOR_RATIO,
    OFFERING_TRIM_MAX_CHARS
  );
}

/** Offering trim capped for the unit/price/ticker fields offering-terms needs. */
export function trimOfferingTermsSectionText(text: string): string {
  const trimmed = trimOfferingSectionText(text);
  if (trimmed.length <= OFFERING_TERMS_TRIM_MAX_CHARS) return trimmed;
  return trimmed.slice(0, OFFERING_TERMS_TRIM_MAX_CHARS);
}
