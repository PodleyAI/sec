/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

export const BENEFICIAL_OWNERSHIP_TRIM_FLOOR_RATIO = 0.08;
export const BENEFICIAL_OWNERSHIP_TRIM_MAX_CHARS = 30_000;

const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*Certain Relationships\b.*$/im,
  /^\s*Related (?:Party|Person)\b.*$/im,
  /^\s*Description of (?:Our )?(?:Capital Stock|Securities)\s*$/im,
  /^\s*Selling Stockholders\s*$/im,
  /^\s*Underwriting\s*$/im,
  /^\s*Legal Matters\s*$/im,
];

/** Keep the ownership table; drop later related-party / securities chapters. */
export function trimBeneficialOwnershipSectionText(text: string): string {
  return trimSectionAtStopHeadings(
    text,
    STOP_HEADING_PATTERNS,
    BENEFICIAL_OWNERSHIP_TRIM_FLOOR_RATIO,
    BENEFICIAL_OWNERSHIP_TRIM_MAX_CHARS
  );
}
