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
 * Form 1-U — a Reg A issuer's Current Report, the Regulation A analogue of an
 * 8-K.
 *
 * One row per filing. The table exists because a Reg A issuer's public timeline
 * otherwise ENDS at its last offering amendment: `rega_offering_history` is
 * written only by the 1-A family, so an issuer that stopped amending its
 * offering in 2025 and has filed current reports ever since appears dormant.
 * 11,600 filings across 737 issuers were invisible for that reason.
 *
 * Metadata-only, like the 25-15 deregistration path. Every 1-U carries its item
 * codes in the submissions payload (11,600 of 11,600), so the event and its date
 * are known without fetching the document — no rate-limit cost for the whole
 * corpus. The narrative body is not stored; the filing remains the record.
 */
export const RegACurrentReportSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  accession_number: Type.String({
    maxLength: 25,
    description: "Filing accession number",
  }),
  file_number: TypeNullable(
    Type.String({
      maxLength: 17,
      description: "SEC file number for the offering the report relates to",
    })
  ),
  filing_date: Type.String({
    description: "Date the current report was filed (YYYY-MM-DD)",
  }),
  form: Type.String({
    maxLength: 16,
    description: "1-U or 1-U/A",
  }),
  /**
   * The item codes exactly as EDGAR reports them, comma-joined ("1,9.1").
   *
   * Kept verbatim alongside the classification because the classification is
   * lossy by design: it collapses a multi-item filing to its most significant
   * event, and 9.1 / 9.2 both flatten to `other`. Anyone re-deriving a different
   * rule needs the original, and the whole point of a metadata-only extractor is
   * that re-deriving costs nothing.
   */
  items: TypeNullable(
    Type.String({
      maxLength: 64,
      description: "Item codes as filed, comma-joined",
    })
  ),
  /**
   * The filing's most significant item, classified.
   *
   * `other` is not a failure: 10,532 of 11,600 filings are item 9.1 "Other
   * Events" and that is genuinely what they are. The value of the row is the
   * DATE — it is what keeps an active issuer from looking dormant — and the
   * classification is what makes the ~1,000 substantive ones findable.
   */
  event_type: Type.String({
    maxLength: 32,
    description: "Classified event: bankruptcy, control_change, fundamental_change, ... or other",
  }),
});

export type RegACurrentReport = Static<typeof RegACurrentReportSchema>;

export const RegACurrentReportPrimaryKeyNames = ["cik", "accession_number"] as const;

export type RegACurrentReportRepositoryStorage = ITabularStorage<
  typeof RegACurrentReportSchema,
  typeof RegACurrentReportPrimaryKeyNames,
  RegACurrentReport
>;

export const REGA_CURRENT_REPORT_REPOSITORY_TOKEN =
  createServiceToken<RegACurrentReportRepositoryStorage>("sec.storage.regACurrentReportRepository");
