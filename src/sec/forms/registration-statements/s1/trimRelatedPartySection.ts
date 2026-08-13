/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

export const RELATED_PARTY_TRIM_FLOOR_RATIO = 0.05;
export const RELATED_PARTY_TRIM_MAX_CHARS = 40_000;

const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*Indemnification(?: of (?:Directors|Officers|Directors and Officers))?\b.*$/im,
  /^\s*Policies and Procedures\b.*$/im,
  /^\s*Related Person Transaction Policy\s*$/im,
  /^\s*Director(?:s)? Independence\s*$/im,
  /^\s*Principal (?:and Selling )?Stockholders?\s*$/im,
  /^\s*Description of (?:Our )?(?:Capital Stock|Securities)\s*$/im,
  /^\s*Underwriting\s*$/im,
  /^\s*Legal Matters\s*$/im,
];

/** Keep related-party transaction prose; drop indemnification / policy back-matter. */
export function trimRelatedPartySectionText(text: string): string {
  return trimSectionAtStopHeadings(
    text,
    STOP_HEADING_PATTERNS,
    RELATED_PARTY_TRIM_FLOOR_RATIO,
    RELATED_PARTY_TRIM_MAX_CHARS
  );
}
