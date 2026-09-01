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
 * Investment Offering History schema based on edgar_investment_offering_history table
 */
export const InvestmentOfferingHistorySchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) of the entity" }),
  file_number: Type.String({
    maxLength: 32,
    description: "SEC file number for the offering",
  }),
  accession_number: Type.String({
    maxLength: 20,
    description: "SEC accession number for the specific filing",
  }),
  minimum_investment_accepted: TypeNullable(
    Type.Number({
      description: "Minimum investment amount accepted from investors",
    })
  ),
  total_offering_amount: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Total amount of securities offered",
    })
  ),
  total_amount_sold: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Total amount of securities sold",
    })
  ),
  total_remaining: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Total amount of securities remaining to be sold",
    })
  ),
  investor_count: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Total number of investors in the offering",
    })
  ),
  non_accredited_count: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Number of non-accredited investors in the offering",
    })
  ),
});

export type InvestmentOfferingHistory = Static<typeof InvestmentOfferingHistorySchema>;

/**
 * Investment Offering History repository storage type and primary key definitions
 */
export const InvestmentOfferingHistoryPrimaryKeyNames = [
  "cik",
  "file_number",
  "accession_number",
] as const;
export type InvestmentOfferingHistoryRepositoryStorage = ITabularStorage<
  typeof InvestmentOfferingHistorySchema,
  typeof InvestmentOfferingHistoryPrimaryKeyNames,
  InvestmentOfferingHistory
>;

export const INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN =
  createServiceToken<InvestmentOfferingHistoryRepositoryStorage>(
    "sec.storage.investmentOfferingHistoryRepository"
  );
