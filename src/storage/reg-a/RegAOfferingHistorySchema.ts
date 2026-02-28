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
 * Reg-A Offering History schema - per-filing snapshot of offering amounts, dates, securities sold
 */
export const RegAOfferingHistorySchema = Type.Object({
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
  filing_date: Type.String({
    format: "date",
    description: "Filing date",
  }),
  qualification_date: TypeNullable(
    Type.String({
      maxLength: 20,
      description: "Offering qualification date",
    })
  ),
  commence_date: TypeNullable(
    Type.String({
      maxLength: 20,
      description: "Offering commencement date",
    })
  ),
  securities_qualified_sold: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Number of qualified securities sold",
    })
  ),
  securities_sold: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Number of securities sold",
    })
  ),
  price_per_security: TypeNullable(
    Type.Number({
      description: "Price per security",
    })
  ),
  aggregate_offering_price: TypeNullable(
    Type.Number({
      description: "Aggregate offering price (issuer)",
    })
  ),
  aggregate_offering_price_holders: TypeNullable(
    Type.Number({
      description: "Aggregate offering price (security holders)",
    })
  ),
  issuer_aggregate_offering: TypeNullable(
    Type.Number({
      description: "Issuer aggregate offering amount (Form 1-A)",
    })
  ),
  security_holder_aggregate: TypeNullable(
    Type.Number({
      description: "Security holder aggregate amount (Form 1-A)",
    })
  ),
  total_aggregate_offering: TypeNullable(
    Type.Number({
      description: "Total aggregate offering amount (Form 1-A)",
    })
  ),
  securities_offered: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Number of securities offered (Form 1-A)",
    })
  ),
  outstanding_securities: TypeNullable(
    Type.Integer({
      minimum: 0,
      description: "Number of outstanding securities (Form 1-A)",
    })
  ),
  estimated_net_amount: TypeNullable(
    Type.Number({
      description: "Estimated net amount to issuer",
    })
  ),
  crd_number: TypeNullable(
    Type.String({
      maxLength: 9,
      description: "Broker-dealer CRD number",
    })
  ),
});

export type RegAOfferingHistory = Static<typeof RegAOfferingHistorySchema>;

export const RegAOfferingHistoryPrimaryKeyNames = [
  "cik",
  "file_number",
  "accession_number",
] as const;
export type RegAOfferingHistoryRepositoryStorage = TabularRepository<
  typeof RegAOfferingHistorySchema,
  typeof RegAOfferingHistoryPrimaryKeyNames,
  RegAOfferingHistory
>;

export const REGA_OFFERING_HISTORY_REPOSITORY_TOKEN =
  createServiceToken<RegAOfferingHistoryRepositoryStorage>(
    "sec.storage.regAOfferingHistoryRepository"
  );
