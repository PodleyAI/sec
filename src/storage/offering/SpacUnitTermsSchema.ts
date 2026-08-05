/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";
import { TypeNullable } from "../../util/TypeBoxUtil";

/** Filing-level SPAC unit offering terms (one row per SPAC filing). */
export const SpacUnitTermsSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  cik: TypeNullable(TypeSecCik()),
  units_offered: TypeNullable(Type.Integer()),
  price_per_unit: TypeNullable(Type.Number()),
  unit_composition: TypeNullable(Type.String({ maxLength: 1024 })),
  warrant_fraction_per_unit: TypeNullable(Type.Number()),
  right_fraction_per_unit: TypeNullable(Type.Number()),
  trust_per_unit: TypeNullable(Type.Number()),
  over_allotment_units: TypeNullable(Type.Integer()),
  exchange: TypeNullable(Type.String({ maxLength: 32 })),
  ticker: TypeNullable(Type.String({ maxLength: 16 })),
  gross_proceeds: TypeNullable(Type.Number()),
  net_proceeds: TypeNullable(Type.Number()),
  confidence: TypeNullable(Type.Number()),
  source_span: TypeNullable(Type.String()),
  created_at: Type.String(),
});
export type SpacUnitTerms = Static<typeof SpacUnitTermsSchema>;

export const SpacUnitTermsPrimaryKeyNames = ["extractor_id", "accession_number"] as const;

export type SpacUnitTermsRepositoryStorage = ITabularStorage<
  typeof SpacUnitTermsSchema,
  typeof SpacUnitTermsPrimaryKeyNames,
  SpacUnitTerms
>;

export const SPAC_UNIT_TERMS_REPOSITORY_TOKEN = createServiceToken<SpacUnitTermsRepositoryStorage>(
  "sec.storage.spacUnitTermsRepository"
);
