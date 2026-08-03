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

/** One row per LOI-extraction filing. Current-state: a re-extraction overwrites by accession. */
export const SpacLoiExtractionSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  cik: TypeSecCik({ description: "SPAC origin CIK (filer)" }),
  form: Type.String({ maxLength: 20 }),
  filing_date: Type.String({ format: "date" }),
  extractor_id: Type.String({ maxLength: 32 }),
  extractor_version: Type.String({ maxLength: 32 }),
  target_name: TypeNullable(Type.String({ maxLength: 200 })),
  loi_date: TypeNullable(
    Type.String({ format: "date", description: "LOI date stated in the narrative" })
  ),
  confidence: Type.Number(),
  source_span: TypeNullable(Type.String({ maxLength: 2000 })),
  model_id: TypeNullable(Type.String({ maxLength: 128 })),
  created_at: Type.String({ format: "date-time" }),
});

export type SpacLoiExtraction = Static<typeof SpacLoiExtractionSchema>;

export const SpacLoiExtractionPrimaryKeyNames = ["accession_number"] as const;
export type SpacLoiExtractionRepositoryStorage = ITabularStorage<
  typeof SpacLoiExtractionSchema,
  typeof SpacLoiExtractionPrimaryKeyNames,
  SpacLoiExtraction
>;

export const SPAC_LOI_EXTRACTION_REPOSITORY_TOKEN =
  createServiceToken<SpacLoiExtractionRepositoryStorage>("sec.storage.spacLoiExtractionRepository");
