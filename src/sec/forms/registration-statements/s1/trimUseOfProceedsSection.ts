/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

export const USE_OF_PROCEEDS_TRIM_FLOOR_RATIO = 0.08;
export const USE_OF_PROCEEDS_TRIM_MAX_CHARS = 15_000;

const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*Dividend(?:s)? Policy\s*$/im,
  /^\s*Capitalization\s*$/im,
  /^\s*Dilution\s*$/im,
  /^\s*Determination of Offering Price\b.*$/im,
  /^\s*Market for\b.*$/im,
  /^\s*Risk Factors\s*$/im,
  /^\s*(?:The|Our) Offering\s*$/im,
];

/**
 * Strip bare numeric footnote markers glued to table labels (`account(3)`,
 * `portion)(3)`) so models copy the purpose golden expects without the marker.
 * Keeps descriptive parentheticals that contain letters (`(2% of gross…)`).
 */
const TRAILING_FOOTNOTE_MARKER =
  /(?<=[\w%)])\((?:\d+)(?:\),\((\d+)\))*\)(?=\s*(?:\||$|\n))/g;

/** Keep use-of-proceeds line items; drop later capital-structure chapters. */
export function trimUseOfProceedsSectionText(text: string): string {
  const trimmed = trimSectionAtStopHeadings(
    text,
    STOP_HEADING_PATTERNS,
    USE_OF_PROCEEDS_TRIM_FLOOR_RATIO,
    USE_OF_PROCEEDS_TRIM_MAX_CHARS
  );
  return trimmed.replace(TRAILING_FOOTNOTE_MARKER, "");
}
