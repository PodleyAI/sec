/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

/** Ignore stop headings in the first this fraction of the section. */
export const EXEC_COMP_TRIM_FLOOR_RATIO = 0.08;

/**
 * Whole-line headings that start post-SCT Item 402 fluff (outstanding awards,
 * employment agreements, director table, etc.). Earliest hit after
 * {@link EXEC_COMP_TRIM_FLOOR_RATIO} is the cut for
 * {@link trimExecutiveCompensationSectionText}.
 */
const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*Director(?:s)? Compensation\s*$/im,
  /^\s*Outstanding (?:Equity|Option) Awards?\b.*$/im,
  /^\s*Employment Agreements?\s*$/im,
  /^\s*Potential Payments\b.*$/im,
  /^\s*(?:Equity|Stock) (?:Incentive|Award) Plans?\b.*$/im,
  /^\s*Grants of Plan-Based Awards\b.*$/im,
  /^\s*Option Exercises\b.*$/im,
  /^\s*Pension Benefits\s*$/im,
  /^\s*Nonqualified Deferred Compensation\s*$/im,
  /^\s*Pay Versus Performance\s*$/im,
  /^\s*Compensation Committee\b.*$/im,
  /^\s*Certain Relationships\b.*$/im,
  /^\s*Principal (?:and Selling )?Stockholders?\s*$/im,
];

/**
 * Drop post–Summary Compensation Table Item 402 fluff from an Executive
 * Compensation section body. Keeps the SCT (and its narrative); cuts at the
 * earliest whole-line stop heading after {@link EXEC_COMP_TRIM_FLOOR_RATIO}.
 */
export function trimExecutiveCompensationSectionText(text: string): string {
  return trimSectionAtStopHeadings(text, STOP_HEADING_PATTERNS, EXEC_COMP_TRIM_FLOOR_RATIO);
}
