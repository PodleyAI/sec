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
 * Investment Offering schema based on edgar_investment_offering table
 */
export const InvestmentOfferingSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) of the entity" }),
  file_number: Type.String({
    maxLength: 10,
    description: "SEC file number for the offering",
  }),
  industry_group: Type.String({
    maxLength: 25,
    description: "Industry group classification",
  }),
  industry_subgroup: TypeNullable(
    Type.String({
      maxLength: 25,
      description: "Industry subgroup classification",
    })
  ),
  date_of_first_sale: TypeNullable(
    Type.String({
      format: "date",
      description: "Date of first sale of securities",
    })
  ),
  exemptions: TypeNullable(
    Type.Any({
      description: "JSON array of exemptions claimed",
    })
  ),
  is_debt_type: TypeNullable(
    Type.Boolean({
      description: "Whether the offering includes debt securities",
    })
  ),
  is_equity_type: TypeNullable(
    Type.Boolean({
      description: "Whether the offering includes equity securities",
    })
  ),
  is_mineral_property_type: TypeNullable(
    Type.Boolean({
      description: "Whether the offering includes mineral property interests",
    })
  ),
  is_option_to_aquire_type: TypeNullable(
    Type.Boolean({
      description: "Whether the offering includes options to acquire securities",
    })
  ),
  is_pooled_investment_type: TypeNullable(
    Type.Boolean({
      description: "Whether the offering is a pooled investment fund",
    })
  ),
  is_security_to_be_aquired: TypeNullable(
    Type.Boolean({
      description: "Whether securities are to be acquired",
    })
  ),
  is_tenant_in_common: TypeNullable(
    Type.Boolean({
      description: "Whether the offering involves tenant-in-common interests",
    })
  ),
  is_business_combination_type: TypeNullable(
    Type.Boolean({
      description: "Whether the offering is part of a business combination",
    })
  ),
  is_other_type: TypeNullable(
    Type.Boolean({
      description: "Whether the offering includes other types of securities",
    })
  ),
  description_of_other: TypeNullable(
    Type.String({
      description: "Description of other security types if is_other_type is true",
    })
  ),
});

export type InvestmentOffering = Static<typeof InvestmentOfferingSchema>;

/**
 * Investment Offering repository storage type and primary key definitions
 */
export const InvestmentOfferingPrimaryKeyNames = ["cik", "file_number"] as const;
export type InvestmentOfferingRepositoryStorage = TabularRepository<
  typeof InvestmentOfferingSchema,
  typeof InvestmentOfferingPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const INVESTMENT_OFFERING_REPOSITORY_TOKEN =
  createServiceToken<InvestmentOfferingRepositoryStorage>(
    "sec.storage.investmentOfferingRepository"
  );
