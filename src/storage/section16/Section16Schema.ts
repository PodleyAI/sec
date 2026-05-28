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
 * One row per Section 16 ownership filing (Form 3 / 4 / 5 and amendments),
 * keyed by accession number.
 */
export const Section16FilingSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25, description: "EDGAR accession number" }),
  form: Type.String({ maxLength: 10, description: "Form symbol (3, 4, 5, 3/A, ...)" }),
  document_type: Type.String({ maxLength: 10, description: "ownershipDocument documentType" }),
  issuer_cik: Type.Integer({ minimum: 0, description: "Issuer CIK" }),
  issuer_name: Type.String({ maxLength: 150, description: "Issuer name" }),
  issuer_trading_symbol: TypeNullable(Type.String({ maxLength: 20 })),
  period_of_report: TypeNullable(Type.String({ description: "Period of report (date)" })),
  filing_date: TypeNullable(Type.String({ description: "Filing date" })),
  not_subject_to_section16: Type.Boolean({ description: "notSubjectToSection16 flag" }),
  no_securities_owned: Type.Boolean({ description: "Form 3 noSecuritiesOwned flag" }),
  remarks: TypeNullable(Type.String()),
});

export type Section16Filing = Static<typeof Section16FilingSchema>;

export const Section16FilingPrimaryKeyNames = ["accession_number"] as const;
export type Section16FilingRepositoryStorage = ITabularStorage<
  typeof Section16FilingSchema,
  typeof Section16FilingPrimaryKeyNames,
  Section16Filing
>;

export const SECTION16_FILING_REPOSITORY_TOKEN =
  createServiceToken<Section16FilingRepositoryStorage>("sec.storage.section16FilingRepository");

/**
 * One row per transaction (derivative or non-derivative) within a Section 16
 * filing. `is_derivative` distinguishes the two tables.
 */
export const Section16TransactionSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  transaction_index: Type.Integer({ minimum: 0 }),
  issuer_cik: Type.Integer({ minimum: 0 }),
  is_derivative: Type.Boolean(),
  security_title: TypeNullable(Type.String({ maxLength: 255 })),
  transaction_date: TypeNullable(Type.String()),
  deemed_execution_date: TypeNullable(Type.String()),
  transaction_code: TypeNullable(Type.String({ maxLength: 4 })),
  transaction_form_type: TypeNullable(Type.String({ maxLength: 4 })),
  equity_swap_involved: TypeNullable(Type.Boolean()),
  acquired_disposed_code: TypeNullable(Type.String({ maxLength: 1 })),
  shares: TypeNullable(Type.Number()),
  price_per_share: TypeNullable(Type.Number()),
  shares_owned_following: TypeNullable(Type.Number()),
  value_owned_following: TypeNullable(Type.Number()),
  direct_or_indirect_ownership: TypeNullable(Type.String({ maxLength: 1 })),
  nature_of_ownership: TypeNullable(Type.String({ maxLength: 255 })),
  conversion_or_exercise_price: TypeNullable(Type.Number()),
  exercise_date: TypeNullable(Type.String()),
  expiration_date: TypeNullable(Type.String()),
  underlying_security_title: TypeNullable(Type.String({ maxLength: 255 })),
  underlying_security_shares: TypeNullable(Type.Number()),
  underlying_security_value: TypeNullable(Type.Number()),
});

export type Section16Transaction = Static<typeof Section16TransactionSchema>;

export const Section16TransactionPrimaryKeyNames = [
  "accession_number",
  "transaction_index",
] as const;
export type Section16TransactionRepositoryStorage = ITabularStorage<
  typeof Section16TransactionSchema,
  typeof Section16TransactionPrimaryKeyNames,
  Section16Transaction
>;

export const SECTION16_TRANSACTION_REPOSITORY_TOKEN =
  createServiceToken<Section16TransactionRepositoryStorage>(
    "sec.storage.section16TransactionRepository"
  );

/**
 * One row per holding (derivative or non-derivative) within a Section 16
 * filing. Holdings carry post-transaction ownership but no transaction.
 */
export const Section16HoldingSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  holding_index: Type.Integer({ minimum: 0 }),
  issuer_cik: Type.Integer({ minimum: 0 }),
  is_derivative: Type.Boolean(),
  security_title: TypeNullable(Type.String({ maxLength: 255 })),
  shares_owned_following: TypeNullable(Type.Number()),
  value_owned_following: TypeNullable(Type.Number()),
  direct_or_indirect_ownership: TypeNullable(Type.String({ maxLength: 1 })),
  nature_of_ownership: TypeNullable(Type.String({ maxLength: 255 })),
  conversion_or_exercise_price: TypeNullable(Type.Number()),
  exercise_date: TypeNullable(Type.String()),
  expiration_date: TypeNullable(Type.String()),
  underlying_security_title: TypeNullable(Type.String({ maxLength: 255 })),
  underlying_security_shares: TypeNullable(Type.Number()),
  underlying_security_value: TypeNullable(Type.Number()),
});

export type Section16Holding = Static<typeof Section16HoldingSchema>;

export const Section16HoldingPrimaryKeyNames = ["accession_number", "holding_index"] as const;
export type Section16HoldingRepositoryStorage = ITabularStorage<
  typeof Section16HoldingSchema,
  typeof Section16HoldingPrimaryKeyNames,
  Section16Holding
>;

export const SECTION16_HOLDING_REPOSITORY_TOKEN =
  createServiceToken<Section16HoldingRepositoryStorage>("sec.storage.section16HoldingRepository");
