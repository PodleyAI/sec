/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

export const UNDERWRITING_TRIM_FLOOR_RATIO = 0.08;

const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*Selling Restrictions\s*$/im,
  /^\s*Notice to Prospective Investors\b.*$/im,
  /^\s*Electronic (?:Offer|Distribution|Prospectus)\b.*$/im,
  /^\s*Legal Matters\s*$/im,
  /^\s*Experts\s*$/im,
  /^\s*Where You Can Find\b.*$/im,
  /^\s*Index to (?:Consolidated )?Financial\b.*$/im,
  /^\s*(?:Consolidated )?Financial Statements\s*$/im,
];

/**
 * Trim Underwriting / Plan of Distribution prose: keep syndicate economics;
 * drop selling-restriction country notices and back-matter.
 */
export function trimUnderwritingSectionText(text: string): string {
  return trimSectionAtStopHeadings(text, STOP_HEADING_PATTERNS, UNDERWRITING_TRIM_FLOOR_RATIO);
}
