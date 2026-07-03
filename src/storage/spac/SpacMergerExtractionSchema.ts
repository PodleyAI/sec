/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * One row per merger-proxy filing (DEFM14A/PREM14A). Current-state: a
 * re-extraction overwrites by accession. `target_*` / `pipe_amount` are
 * correlated onto the matching `spac_deal` by `deriveDeals`; `merger_consideration`
 * stays here (report + provenance only).
 */
export const SpacMergerExtractionSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  cik: Type.Integer({ minimum: 0, description: "SPAC origin CIK (filer)" }),
  form: Type.String({ maxLength: 20 }),
  filing_date: Type.String({ format: "date" }),
  extractor_id: Type.String({ maxLength: 32 }),
  extractor_version: Type.String({ maxLength: 32 }),
  target_name: TypeNullable(Type.String({ maxLength: 300 })),
  target_cik: TypeNullable(Type.Integer({ minimum: 0 })),
  target_observation_id: TypeNullable(Type.Integer({ minimum: 0 })),
  target_description: TypeNullable(
    Type.String({ maxLength: 4000, description: "Target company description" })
  ),
  pipe_amount: TypeNullable(Type.Number()),
  merger_consideration: TypeNullable(Type.String({ maxLength: 2000 })),
  confidence: Type.Number(),
  source_span: TypeNullable(Type.String({ maxLength: 2000 })),
  model_id: TypeNullable(Type.String({ maxLength: 128 })),
  created_at: Type.String({ format: "date-time" }),
});

export type SpacMergerExtraction = Static<typeof SpacMergerExtractionSchema>;

export const SpacMergerExtractionPrimaryKeyNames = ["accession_number"] as const;
export type SpacMergerExtractionRepositoryStorage = ITabularStorage<
  typeof SpacMergerExtractionSchema,
  typeof SpacMergerExtractionPrimaryKeyNames,
  SpacMergerExtraction
>;

export const SPAC_MERGER_EXTRACTION_REPOSITORY_TOKEN =
  createServiceToken<SpacMergerExtractionRepositoryStorage>(
    "sec.storage.spacMergerExtractionRepository"
  );
