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
 * Reg-A Equity Class schema - equity classes from 1-A (common, preferred, debt)
 */
export const RegAEquityClassSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  file_number: Type.String({
    maxLength: 17,
    description: "SEC file number for the offering",
  }),
  accession_number: Type.String({
    maxLength: 25,
    description: "Filing accession number",
  }),
  equity_type: Type.String({
    maxLength: 20,
    description: "Type of equity: common, preferred, debt",
  }),
  /**
   * NOT nullable, because it is the fifth component of this table's primary key
   * and PostgreSQL forces primary-key columns NOT NULL. Declaring it
   * `TypeNullable` was a contradiction the type system could not see: the schema
   * promised a null was storable, the key guaranteed it was not, and the writer
   * believed the schema — so an unnamed class took the whole filing down with a
   * NOT NULL violation on real Postgres while round-tripping fine against the
   * in-memory storage the tests use.
   *
   * Nothing writes a null any more: `equityClassNameForStorage` in
   * Form_1_A.storage.ts collapses every "not applicable" spelling the filers use
   * (null, empty, N/A, NA, NONE, 0, -, --) onto one `N/A` sentinel, so the
   * column is total by construction rather than by hope.
   */
  class_name: Type.String({
    maxLength: 50,
    description: "Name of the equity class ('N/A' when the filer named none)",
  }),
  outstanding: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Number of outstanding shares/units",
    })
  ),
  cusip: TypeNullable(
    Type.String({
      maxLength: 9,
      description: "CUSIP identifier",
    })
  ),
  publicly_traded: TypeNullable(
    Type.String({
      maxLength: 50,
      description: "Exchange or market where publicly traded",
    })
  ),
});

export type RegAEquityClass = Static<typeof RegAEquityClassSchema>;

export const RegAEquityClassPrimaryKeyNames = [
  "cik",
  "file_number",
  "accession_number",
  "equity_type",
  "class_name",
] as const;
export type RegAEquityClassRepositoryStorage = ITabularStorage<
  typeof RegAEquityClassSchema,
  typeof RegAEquityClassPrimaryKeyNames,
  RegAEquityClass
>;

export const REGA_EQUITY_CLASS_REPOSITORY_TOKEN =
  createServiceToken<RegAEquityClassRepositoryStorage>("sec.storage.regAEquityClassRepository");
