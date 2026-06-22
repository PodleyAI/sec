/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { Static, Type } from "typebox";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Form 8-K Event schema - represents individual items reported in 8-K filings.
 * Each 8-K filing can report multiple items (e.g., "1.01", "2.02", "9.01").
 * This table stores one row per item per filing.
 */
export const Form8KEventSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  accession_number: Type.String({
    maxLength: 20,
    description: "SEC accession number - unique identifier for the filing",
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

export const Form8KEventPrimaryKeyNames = ["cik", "accession_number", "item_code"] as const;

export type Form8KEventRepositoryStorage = ITabularStorage<
  typeof Form8KEventSchema,
  typeof Form8KEventPrimaryKeyNames,
  Form8KEvent
>;

export const FORM_8K_EVENT_REPOSITORY_TOKEN =
  createServiceToken<Form8KEventRepositoryStorage>("sec.storage.form8kEventRepository");
