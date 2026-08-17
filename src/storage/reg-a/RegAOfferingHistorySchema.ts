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
 * Reg-A Offering History schema - per-filing snapshot of offering amounts, dates, securities sold
 */
export const RegAOfferingHistorySchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
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
  /**
   * The other two components of the Form 1-A offering total.
   *
   * `totalAggregateOffering` is the sum of FOUR figures, not two: the issuer's
   * own raise, the selling security holders', securities qualified within the
   * last 12 months, and any concurrent offering. Persisting only the first two
   * left the total unreconcilable on 1,346 rows — XY (CIK 1577351) files
   * 8.00 + 44,178,387.90 + 5,219,309.10 + 16,966,248.00 = 66,363,953.00, and
   * without these two the arithmetic is short by $22.2M.
   *
   * They matter beyond the arithmetic: both count against the Reg A annual
   * offering cap, so the total alone does not say how much headroom an issuer
   * has left.
   */
  qualification_offering_aggregate: TypeNullable(
    Type.Number({
      description: "Aggregate qualified within the last 12 months (Form 1-A)",
    })
  ),
  concurrent_offering_aggregate: TypeNullable(
    Type.Number({
      description: "Aggregate offered concurrently in another offering (Form 1-A)",
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
export type RegAOfferingHistoryRepositoryStorage = ITabularStorage<
  typeof RegAOfferingHistorySchema,
  typeof RegAOfferingHistoryPrimaryKeyNames,
  RegAOfferingHistory
>;

export const REGA_OFFERING_HISTORY_REPOSITORY_TOKEN =
  createServiceToken<RegAOfferingHistoryRepositoryStorage>(
    "sec.storage.regAOfferingHistoryRepository"
  );
