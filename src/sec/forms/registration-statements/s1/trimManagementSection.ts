/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { trimSectionAtStopHeadings } from "./trimSectionAtStopHeadings";

/** Ignore stop headings in the first this fraction of the section. */
export const MANAGEMENT_TRIM_FLOOR_RATIO = 0.08;

/**
 * Whole-line headings that start post-roster governance fluff inside a
 * Management section. Earliest hit after {@link MANAGEMENT_TRIM_FLOOR_RATIO}
 * is the cut point for {@link trimManagementSectionText}.
 */
const STOP_HEADING_PATTERNS: readonly RegExp[] = [
  /^\s*Board Committees\s*$/im,
  /^\s*Committees of (?:the |Our )?Board(?: of Directors)?\s*$/im,
  /^\s*Audit Committee\s*$/im,
  /^\s*Compensation Committee\s*$/im,
  /^\s*Nominating(?: and)?(?: Corporate)?(?: Governance)?(?: Committee)?\s*$/im,
  /^\s*Corporate Governance(?: \(continued\))?\s*$/im,
  /^\s*Board Leadership(?: Structure)?\s*$/im,
  /^\s*Director(?:s)? Independence\s*$/im,
  /^\s*Board Composition(?: and Risk Oversight)?\s*$/im,
  /^\s*Role of (?:the )?Board(?: of Directors)?(?: in Risk Oversight)?\s*$/im,
  /^\s*(?:Number and Terms? of|Terms? of(?: Our)?|Class(?:es)? of) Officers and Directors\b.*$/im,
  /^\s*(?:Number and Terms? of|Terms? of(?: Our)?|Class(?:es)? of) Directors\b.*$/im,
  /^\s*(?:Officer and Director|Director and Officer) Qualifications?\s*$/im,
  /^\s*Family Relationships?\s*$/im,
  /^\s*Involvement in Certain Legal Proceedings\s*$/im,
  /^\s*Code of (?:Business )?(?:Conduct|Ethics)(?: and Ethics)?\s*$/im,
  /^\s*Director Compensation\s*$/im,
  /^\s*Executive Compensation\s*$/im,
];

/**
 * Drop post-roster governance fluff from a Management section body.
 * Keeps the roster table and officer/director bios; cuts at the earliest
 * whole-line stop heading after {@link MANAGEMENT_TRIM_FLOOR_RATIO}.
 */
export function trimManagementSectionText(text: string): string {
  return trimSectionAtStopHeadings(text, STOP_HEADING_PATTERNS, MANAGEMENT_TRIM_FLOOR_RATIO);
}
