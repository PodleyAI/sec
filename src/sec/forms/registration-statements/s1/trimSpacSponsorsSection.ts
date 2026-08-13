/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

export const SPAC_SPONSORS_TRIM_FLOOR_RATIO = 0.08;
export const SPAC_SPONSORS_TRIM_MAX_CHARS = 20_000;

const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*(?:The|Our) Offering\s*$/im,
  /^\s*Risk Factors\s*$/im,
  /^\s*(?:Our )?Management\s*$/im,
  /^\s*Underwriting\s*$/im,
  /^\s*Conflicts of Interest\s*$/im,
];

/** Keep sponsor identity prose; drop later offering/management chapters. */
export function trimSpacSponsorsSectionText(text: string): string {
  return trimSectionAtStopHeadings(
    text,
    STOP_HEADING_PATTERNS,
    SPAC_SPONSORS_TRIM_FLOOR_RATIO,
    SPAC_SPONSORS_TRIM_MAX_CHARS
  );
}
