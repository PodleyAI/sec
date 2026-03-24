/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Reg-A Equity Class schema - equity classes from 1-A (common, preferred, debt)
 */
export const RegAEquityClassSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
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
  class_name: TypeNullable(
    Type.String({
      maxLength: 50,
      description: "Name of the equity class",
    })
  ),
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
