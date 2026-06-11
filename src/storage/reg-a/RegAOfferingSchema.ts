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
 * Reg-A Offering schema - core offering entity for Regulation A filings (1-A, 1-K, 1-Z)
 */
export const RegAOfferingSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
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
  securities_offered_type: TypeNullable(
    Type.String({
      maxLength: 100,
      description: "Type of securities offered",
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
