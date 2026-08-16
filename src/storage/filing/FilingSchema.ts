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
  // These two are UNBOUNDED where the widths above are merely generous, and the
  // difference is not stylistic. The note above sized them from a 20k-CIK scan
  // that found file_number topping out at 107; across the full 27M-filing corpus
  // the real maximum is 450 (film_number 368). Sampling cannot find the tail of
  // a list whose length scales with co-registrant count — the note says so
  // itself ("has no natural bound") — so any n is a bet that the next filer
  // stays under it, and varchar(255) had already lost that bet before the scan
  // was taken.
  //
  // The filers concerned are insurance SEPARATE ACCOUNTS, which register one
  // offering covering dozens of underlying contracts and so carry a file number
  // per contract. It is a structural property of that filer type, not a freak
  // value, which is why the seven affected CIKs are all the same kind of entity.
  //
  // The cost was not a truncated column but SEVEN MISSING COMPANIES. One
  // over-long filing aborts the whole StoreSubmissionsTask graph, so the CIK's
  // entire filing history, entity row, tickers and addresses are never written —
  // and `fetchAndStoreSubmission` catches the throw, warns, and marks the CIK
  // failed, so the sweep continues and nothing surfaces in `db stats` or a dead
  // letter. Those seven had been absent from a 27M-row corpus since the original
  // bootstrap.
  //
  // Dropping maxLength is enough to fix existing deployments: unlike an array
  // conversion, `alignPostgresColumnTypes` DOES widen varchar -> unbounded text
  // when the schema drops its bound, so the next `db setup` converts them.
  file_number: TypeNullable(
    Type.String({
      description: "File number(s) assigned by the SEC, comma-joined when several apply",
    })
  ),
  film_number: TypeNullable(
    Type.String({
      description: "Film number(s) assigned by the SEC, comma-joined when several apply",
    })
  ),
  // Nullable because EDGAR's submissions payload does not guarantee it: a
  // filing with no primary document is an error state downstream (the forms
  // pipeline dead-letters it PRIMARY_DOC_UNRESOLVED), but it is a real row that
  // has to be storable and readable rather than one that fails to ingest.
  primary_doc: TypeNullable(
    Type.String({
      maxLength: 128,
      description: "Primary document filename",
    })
  ),
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
