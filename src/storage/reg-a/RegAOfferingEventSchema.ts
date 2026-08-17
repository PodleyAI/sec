/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * A dated event against a Reg A offering that is neither a report nor a
 * disclosure of figures: an offering-circular supplement (253G1–253G4), or a
 * withdrawal (1-A-W, 1-Z-W).
 *
 * ## Why these are worth a row
 *
 * A 253G supplement is what the offering BECAME after qualification — the Reg A
 * analogue of a 424(b) prospectus supplement. At 5,325 filings across the four
 * subsections it is the second-largest Reg A form family after the 1-U, and none
 * of it was recorded: an issuer that has amended its circular eleven times since
 * qualifying looked identical to one that has not touched it.
 *
 * A withdrawal is the terminal state the record otherwise lacks — an offering
 * that was pulled before qualification simply stopped having filings.
 *
 * ## Metadata-only, and unusually cheaply so
 *
 * Nothing here reads a document. The two facts that matter both arrive in the
 * submissions payload: EDGAR records the `024-` file number on **100%** of these
 * filings (5,325 of 5,325 supplements, 539 of 549 withdrawals), which is the
 * link back to the offering, and the rule subsection IS the form name.
 *
 * That was worth measuring rather than assuming, because the alternative was
 * expensive and would have delivered less. The documents are 1–2 MB of narrative
 * HTML — 8 GB across the corpus — and a survey of 30 of them found terms present
 * in only 13–30% even when scanning the whole document: 80% are prose
 * supplements ("This document supplements, and should be read in conjunction
 * with, the Offering Circular dated…") rather than restated circulars. Fetching
 * all 5,325 would have cost ~20 minutes of the shared 8 req/s budget to extract
 * a price from roughly a quarter of them.
 *
 * Terms extraction over that minority remains possible later; the link and the
 * date are what every consumer needs first, and they are free.
 */
export const RegAOfferingEventSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  accession_number: Type.String({ maxLength: 25, description: "Filing accession number" }),
  /**
   * The offering this event belongs to, as EDGAR recorded it — `024-…`.
   *
   * Nullable only for the 1-Z-W family, which withdraws an EXIT report and so
   * files under the `24R-` reporting number or none at all; every 253G and
   * 1-A-W carries one.
   */
  file_number: TypeNullable(
    Type.String({ maxLength: 17, description: "SEC file number of the offering" })
  ),
  filing_date: Type.String({ description: "Date the event was filed (YYYY-MM-DD)" }),
  form: Type.String({ maxLength: 16, description: "253G1..253G4, 1-A-W, 1-Z-W or an amendment" }),
  /**
   * The event, grouped.
   *
   * Deliberately coarse: `circular_supplement` covers all four 253G
   * subsections rather than naming each one, because the precise regulatory
   * meaning of 253(g)(1) versus (g)(3) is a reading of the rule and not
   * something the filing states. `form` preserves the exact subsection, so any
   * finer reading can be derived without re-extracting.
   */
  event_type: Type.String({
    maxLength: 32,
    description: "circular_supplement | offering_withdrawn | exit_report_withdrawn",
  }),
});

export type RegAOfferingEvent = Static<typeof RegAOfferingEventSchema>;

export const RegAOfferingEventPrimaryKeyNames = ["cik", "accession_number"] as const;

export type RegAOfferingEventRepositoryStorage = ITabularStorage<
  typeof RegAOfferingEventSchema,
  typeof RegAOfferingEventPrimaryKeyNames,
  RegAOfferingEvent
>;

export const REGA_OFFERING_EVENT_REPOSITORY_TOKEN =
  createServiceToken<RegAOfferingEventRepositoryStorage>("sec.storage.regAOfferingEventRepository");
