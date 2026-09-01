/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeAccessionNumber } from "../../sec/edgar/accessionNumber";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * Form 8-K Event schema — one row per item reported in an 8-K filing
 * (`(cik, accession_number, item_code)` is the natural identity within a
 * single extractor version, e.g. `"1.01"`, `"2.02"`, `"9.01"`).
 *
 * `event_id` is a synthetic surrogate primary key so an extractor re-run
 * under a newer `extractor_version` can co-exist with the prior version's
 * rows for the same filing without colliding on the primary key; that
 * way diffs across versions stay queryable. The natural key
 * `(cik, accession_number, extractor_id, extractor_version, item_code)`
 * is enforced UNIQUE in the DI wiring (Postgres/SQLite emit a real UNIQUE
 * index; the in-memory backend enforces it programmatically).
 */
export const Form8KEventSchema = Type.Object({
  event_id: Type.Integer({
    description: "Synthetic surrogate key; AUTOINCREMENT INTEGER PRIMARY KEY",
    "x-auto-generated": true,
  }),
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  accession_number: TypeAccessionNumber({
    description: "SEC accession number - unique identifier for the filing",
  }),
  extractor_id: Type.String({
    maxLength: 16,
    description: "Form-mapped extractor id (e.g. '8-K')",
  }),
  extractor_version: Type.String({
    maxLength: 32,
    description: "Semver of the extractor that produced this row",
  }),
  item_code: Type.String({
    maxLength: 10,
    description: "8-K item code (e.g., 1.01, 2.02, 9.01)",
  }),
  item_description: TypeNullable(
    Type.String({
      maxLength: 200,
      description: "Human-readable description of the item",
    })
  ),
  filing_date: Type.String({
    description: "Date the filing was submitted to the SEC (YYYY-MM-DD format)",
  }),
  report_date: TypeNullable(
    Type.String({
      description: "Period of report date (YYYY-MM-DD format)",
    })
  ),
  is_amendment: Type.Boolean({
    description: "Whether this is an amendment (8-K/A)",
  }),
});

export type Form8KEvent = Static<typeof Form8KEventSchema>;

export const Form8KEventPrimaryKeyNames = ["event_id"] as const;

/**
 * Natural-key UNIQUE constraint columns — `(cik, accession_number,
 * extractor_id, extractor_version, item_code)`. Wired through `createStorage`
 * so the underlying tabular backend emits the matching UNIQUE index.
 */
export const Form8KEventUniqueIndexes = [
  ["cik", "accession_number", "extractor_id", "extractor_version", "item_code"] as const,
] as const;

export type Form8KEventRepositoryStorage = ITabularStorage<
  typeof Form8KEventSchema,
  typeof Form8KEventPrimaryKeyNames,
  Form8KEvent
>;

export const FORM_8K_EVENT_REPOSITORY_TOKEN = createServiceToken<Form8KEventRepositoryStorage>(
  "sec.storage.form8kEventRepository"
);
