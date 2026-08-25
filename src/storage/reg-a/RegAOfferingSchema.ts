/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * Reg-A Offering schema - core offering entity for Regulation A filings (1-A, 1-K, 1-Z)
 */
export const RegAOfferingSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  file_number: Type.String({
    maxLength: 17,
    description: "SEC file number for the offering",
  }),
  issuer_name: TypeNullable(
    Type.String({
      maxLength: 150,
      description: "Name of the issuer",
    })
  ),
  jurisdiction: TypeNullable(
    Type.String({
      maxLength: 10,
      description: "Jurisdiction of organization (state/country code)",
    })
  ),
  sic_code: TypeNullable(
    Type.Integer({
      minimum: 0,
      maximum: 9999,
      description: "Standard Industrial Classification code",
    })
  ),
  tier: TypeNullable(
    Type.String({
      maxLength: 10,
      description: "Offering tier (Tier1 or Tier2)",
    })
  ),
  financial_statement_audit_status: TypeNullable(
    Type.String({
      maxLength: 20,
      description: "Audit status of financial statements (Audited/Unaudited)",
    })
  ),
  /**
   * An ARRAY because the form is a multi-select, not because a list is tidier.
   * Form 1-A declares `securitiesOfferedTypes` as
   * `minOccurs="1" maxOccurs="6"` over a six-value enumeration, so a filer
   * offering both equity and warrants selects both and the parser yields two
   * values.
   *
   * A single `String({ maxLength: 100 })` would be wrong on both counts: the
   * longest single enum value ("Security to be acquired upon exercise of
   * option, warrant or other right to acquire security") is 90 characters and
   * fits, but COMBINATIONS overflow — all six selected would run past 250 —
   * and stringifying a multi-select into one cell (a Postgres array literal
   * like `{"Equity (common or preferred stock)","Debt"}` stored as text) risks
   * truncation and leaves it unqueryable as the list it actually is.
   *
   * `investment_offerings.exemptions` is the same shape and the precedent for
   * this: `Type.Array(Type.String())` emits `text[]` on Postgres.
   */
  securities_offered_type: TypeNullable(
    Type.Array(Type.String(), {
      description: "Types of securities offered (Form 1-A multi-select, up to 6)",
    })
  ),
  industry_group: TypeNullable(
    Type.String({
      maxLength: 25,
      description: "Industry group classification",
    })
  ),
  status: Type.String({
    maxLength: 20,
    description: "Offering status: pending, reporting, exit",
  }),
  as_of: TypeNullable(
    Type.String({
      format: "date",
      description:
        "Filing date of the filing that last shaped this row; writes guard against out-of-order processing with it",
    })
  ),
});

export type RegAOffering = Static<typeof RegAOfferingSchema>;

export const RegAOfferingPrimaryKeyNames = ["cik", "file_number"] as const;
export type RegAOfferingRepositoryStorage = ITabularStorage<
  typeof RegAOfferingSchema,
  typeof RegAOfferingPrimaryKeyNames,
  RegAOffering
>;

export const REGA_OFFERING_REPOSITORY_TOKEN = createServiceToken<RegAOfferingRepositoryStorage>(
  "sec.storage.regAOfferingRepository"
);
