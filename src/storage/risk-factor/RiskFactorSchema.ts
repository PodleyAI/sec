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

/**
 * One row per risk factor disclosed by a filing, in document order
 * (`risk_index`). `headline` is the filer's caption verbatim — the row's
 * identity for a reader — and `category` the heading it sits under, as printed;
 * neither is normalized to a taxonomy, so the rows stay faithful to the filing
 * and any classification can be derived on top later.
 */
export const RiskFactorSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  risk_index: Type.Integer(),
  cik: TypeNullable(TypeSecCik()),
  category: TypeNullable(Type.String({ maxLength: 512 })),
  headline: Type.String({ maxLength: 2048 }),
  confidence: TypeNullable(Type.Number()),
  source_span: TypeNullable(Type.String()),
  created_at: Type.String(),
});
export type RiskFactor = Static<typeof RiskFactorSchema>;

export const RiskFactorPrimaryKeyNames = [
  "extractor_id",
  "accession_number",
  "risk_index",
] as const;

export type RiskFactorRepositoryStorage = ITabularStorage<
  typeof RiskFactorSchema,
  typeof RiskFactorPrimaryKeyNames,
  RiskFactor
>;

export const RISK_FACTOR_REPOSITORY_TOKEN = createServiceToken<RiskFactorRepositoryStorage>(
  "sec.storage.riskFactorRepository"
);
