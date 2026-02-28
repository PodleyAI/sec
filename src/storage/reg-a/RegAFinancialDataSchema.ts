/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TabularRepository } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { Static, Type } from "typebox";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Reg-A Financial Data schema - EAV financial data from balance sheets
 */
export const RegAFinancialDataSchema = Type.Object({
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
  field_name: Type.String({
    maxLength: 80,
    description: "Name of the financial data field",
  }),
  field_value: TypeNullable(
    Type.Number({
      description: "Numeric value of the financial data field",
    })
  ),
});

export type RegAFinancialData = Static<typeof RegAFinancialDataSchema>;

export const RegAFinancialDataPrimaryKeyNames = [
  "cik",
  "file_number",
  "accession_number",
  "field_name",
] as const;
export type RegAFinancialDataRepositoryStorage = TabularRepository<
  typeof RegAFinancialDataSchema,
  typeof RegAFinancialDataPrimaryKeyNames,
  RegAFinancialData
>;

export const REGA_FINANCIAL_DATA_REPOSITORY_TOKEN =
  createServiceToken<RegAFinancialDataRepositoryStorage>(
    "sec.storage.regAFinancialDataRepository"
  );
