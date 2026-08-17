/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maps a Reg A event form to its grouped event type.
 *
 * The grouping is coarse on purpose. All four 253G subsections collapse to
 * `circular_supplement`: which of Rule 253(g)(1)–(4) a filer chose is a reading
 * of the rule rather than something the filing asserts, and the row keeps the
 * exact `form` so a finer classification can be derived later without
 * re-extracting anything.
 *
 * The two withdrawal families do NOT collapse together, because they end
 * different things — 1-A-W withdraws the offering statement (the offering never
 * happens), 1-Z-W withdraws the exit report (the offering is NOT over after
 * all). Reporting both as "withdrawn" would invert the meaning of one of them.
 */
export const REGA_OFFERING_EVENT_TYPES = {
  "253G1": "circular_supplement",
  "253G2": "circular_supplement",
  "253G3": "circular_supplement",
  "253G4": "circular_supplement",
  "1-A-W": "offering_withdrawn",
  "1-A-W/A": "offering_withdrawn",
  "1-Z-W": "exit_report_withdrawn",
  "1-Z-W/A": "exit_report_withdrawn",
} as const;

export type RegAOfferingEventType =
  (typeof REGA_OFFERING_EVENT_TYPES)[keyof typeof REGA_OFFERING_EVENT_TYPES];

/**
 * Classifies an event form.
 *
 * Returns `undefined` for a form this extractor does not handle rather than
 * guessing: an unrecognised form here means a wiring error, and inventing an
 * event type would file it under a meaning nobody chose.
 */
export function classifyRegAOfferingEvent(form: string): RegAOfferingEventType | undefined {
  const key = form.trim().toUpperCase() as keyof typeof REGA_OFFERING_EVENT_TYPES;
  return REGA_OFFERING_EVENT_TYPES[key];
}
