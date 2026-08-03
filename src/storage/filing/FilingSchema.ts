/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Filing schema - represents SEC filings stored in the database
 */
export const FilingSchema = Type.Object({
  cik: TypeSecCik({
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  accession_number: Type.String({
    maxLength: 20,
    description: "SEC accession number - unique identifier for the filing",
  }),
  filing_date: Type.String({
    description: "Date the filing was submitted to the SEC (YYYY-MM-DD format)",
  }),
  report_date: TypeNullable(
    Type.String({
      description: "Report date of the filing (YYYY-MM-DD format, if applicable)",
    })
  ),
  acceptance_date: Type.String({
    description: "Date and time the filing was accepted by the SEC (ISO 8601 format)",
  }),
  // Widths below are sized against real EDGAR data, not the nominal shape of a
  // single value: `file_number`, `film_number` and `act` arrive comma-joined for
  // multi-registrant filings, so their length scales with the number of
  // co-registrants and has no natural bound. A 20k-CIK scan of the bulk
  // submissions found max 16 / 107 / 89 / 80 / 5 for form / file_number /
  // film_number / primary_doc_description / act — the previous 8 / 10 / 10 / 45
  // / 2 rejected ~4%, ~10%, ~0.6%, ~6% and ~0.6% of CIKs respectively, and a
  // rejected address or column overflow fails that CIK's entire submission.
  // Postgres varchar(n) costs nothing over a shorter n, so these are generous.
  form: TypeNullable(
    Type.String({
      maxLength: 32,
      description: "Form type (e.g., 10-K, 10-Q, 8-K, SEC STAFF ACTION)",
    })
  ),
  file_number: TypeNullable(
    Type.String({
      maxLength: 255,
      description: "File number(s) assigned by the SEC, comma-joined when several apply",
    })
  ),
  film_number: TypeNullable(
    Type.String({
      maxLength: 255,
      description: "Film number(s) assigned by the SEC, comma-joined when several apply",
    })
  ),
  primary_doc: Type.String({
    maxLength: 128,
    description: "Primary document filename",
  }),
  primary_doc_description: TypeNullable(
    Type.String({
      maxLength: 255,
      description: "Description of the primary document",
    })
  ),
  size: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Size of the filing in bytes",
    })
  ),
  is_xbrl: TypeNullable(
    Type.Boolean({
      description: "Whether the filing contains XBRL data",
    })
  ),
  is_inline_xbrl: TypeNullable(
    Type.Boolean({
      description: "Whether the filing contains inline XBRL data",
    })
  ),
  items: TypeNullable(
    Type.String({
      description: "Items covered in the filing (for certain form types)",
    })
  ),
  act: TypeNullable(
    Type.String({
      maxLength: 16,
      description:
        'Act(s) under which the filing was made, comma-joined when several apply (e.g. "40,33")',
    })
  ),
});

/**
 * Filing type definition
 */
export type Filing = Static<typeof FilingSchema>;

/**
 * Primary key definition for Filing table
 */
export const FilingPrimaryKeyNames = ["cik", "accession_number"] as const;

/**
 * Filing repository storage type
 */
export type FilingRepositoryStorage = ITabularStorage<
  typeof FilingSchema,
  typeof FilingPrimaryKeyNames,
  Filing
>;

/**
 * Dependency injection token for Filing repository
 */
export const FILING_REPOSITORY_TOKEN = createServiceToken<FilingRepositoryStorage>(
  "sec.storage.filingRepository"
);
