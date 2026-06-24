/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/** One row per redemption-extraction filing. Current-state: a re-extraction overwrites by accession. */
export const SpacRedemptionExtractionSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  cik: Type.Integer({ minimum: 0, description: "SPAC origin CIK (filer)" }),
  form: Type.String({ maxLength: 20 }),
  filing_date: Type.String({ format: "date" }),
  extractor_id: Type.String({ maxLength: 32 }),
  extractor_version: Type.String({ maxLength: 32 }),
  redemption_shares: TypeNullable(Type.Integer({ minimum: 0 })),
  redemption_amount: TypeNullable(Type.Number()),
  price_per_share: TypeNullable(Type.Number()),
  confidence: Type.Number(),
  source_span: TypeNullable(Type.String({ maxLength: 2000 })),
  model_id: TypeNullable(Type.String({ maxLength: 128 })),
  created_at: Type.String({ format: "date-time" }),
});

export type SpacRedemptionExtraction = Static<typeof SpacRedemptionExtractionSchema>;

export const SpacRedemptionExtractionPrimaryKeyNames = ["accession_number"] as const;
export type SpacRedemptionExtractionRepositoryStorage = ITabularStorage<
  typeof SpacRedemptionExtractionSchema,
  typeof SpacRedemptionExtractionPrimaryKeyNames,
  SpacRedemptionExtraction
>;

export const SPAC_REDEMPTION_EXTRACTION_REPOSITORY_TOKEN =
  createServiceToken<SpacRedemptionExtractionRepositoryStorage>(
    "sec.storage.spacRedemptionExtractionRepository"
  );
