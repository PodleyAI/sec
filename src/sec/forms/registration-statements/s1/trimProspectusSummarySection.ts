/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

export const PROSPECTUS_SUMMARY_TRIM_FLOOR_RATIO = 0.05;

/**
 * Hard ceiling for prospectus-summary prose. Mega sections (100k–1M chars) are
 * almost always segmenter collapses that swallowed the whole prospectus; blank-
 * check / profile signals live in the first tens of KB.
 */
export const PROSPECTUS_SUMMARY_TRIM_MAX_CHARS = 60_000;

const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*Summary of (?:the )?Risk Factors\s*$/im,
  /^\s*Risk Factors\s*$/im,
  /^\s*(?:The|Our) Offering\s*$/im,
  /^\s*Implications of Being\b.*$/im,
  /^\s*(?:Status as an )?Emerging Growth Company\b.*$/im,
  /^\s*Corporate Information\s*$/im,
  /^\s*Summary (?:Consolidated )?Financial\b.*$/im,
  /^\s*Selected (?:Consolidated )?Financial\b.*$/im,
];

/**
 * Trim Prospectus Summary / Business prose for spac-classification and
 * spac-profile: drop post-summary risk/offering/financial fluff, and cap
 * segmenter-collapsed megasections.
 */
export function trimProspectusSummarySectionText(text: string): string {
  return trimSectionAtStopHeadings(
    text,
    STOP_HEADING_PATTERNS,
    PROSPECTUS_SUMMARY_TRIM_FLOOR_RATIO,
    PROSPECTUS_SUMMARY_TRIM_MAX_CHARS
  );
}
