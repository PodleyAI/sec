/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/** Filing-level common-equity offering terms (one row per non-SPAC filing). */
export const OfferingTermsSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  cik: TypeNullable(TypeSecCik()),
  security_type: TypeNullable(Type.String({ maxLength: 128 })),
  shares_offered: TypeNullable(Type.Integer()),
  price: TypeNullable(Type.Number()),
  price_low: TypeNullable(Type.Number()),
  price_high: TypeNullable(Type.Number()),
  gross_proceeds: TypeNullable(Type.Number()),
  net_proceeds: TypeNullable(Type.Number()),
  over_allotment_shares: TypeNullable(Type.Integer()),
  exchange: TypeNullable(Type.String({ maxLength: 32 })),
  ticker: TypeNullable(Type.String({ maxLength: 16 })),
  par_value: TypeNullable(Type.Number()),
  confidence: TypeNullable(Type.Number()),
  source_span: TypeNullable(Type.String()),
  created_at: Type.String(),
});
export type OfferingTerms = Static<typeof OfferingTermsSchema>;

export const OfferingTermsPrimaryKeyNames = ["extractor_id", "accession_number"] as const;

export type OfferingTermsRepositoryStorage = ITabularStorage<
  typeof OfferingTermsSchema,
  typeof OfferingTermsPrimaryKeyNames,
  OfferingTerms
>;

export const OFFERING_TERMS_REPOSITORY_TOKEN = createServiceToken<OfferingTermsRepositoryStorage>(
  "sec.storage.offeringTermsRepository"
);
