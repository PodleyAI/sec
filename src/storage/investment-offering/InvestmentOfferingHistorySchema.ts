//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, TypeNullable } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";

/**
 * Investment Offering History schema based on edgar_investment_offering_history table
 */
export const InvestmentOfferingHistorySchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) of the entity" }),
  file_number: Type.String({
    maxLength: 10,
    description: "SEC file number for the offering",
  }),
  accession_number: Type.String({
    maxLength: 10,
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
export type InvestmentOfferingHistoryRepositoryStorage = TabularRepository<
  typeof InvestmentOfferingHistorySchema,
  typeof InvestmentOfferingHistoryPrimaryKeyNames
>;

export const INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN =
  createServiceToken<InvestmentOfferingHistoryRepositoryStorage>(
    "sec.storage.investmentOfferingHistoryRepository"
  );
