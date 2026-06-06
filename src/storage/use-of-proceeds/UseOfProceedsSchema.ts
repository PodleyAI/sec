/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable } from "../../util/TypeBoxUtil";

/** Narrative-tolerant use-of-proceeds line item (one row per stated purpose). */
export const UseOfProceedsSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  line_index: Type.Integer(),
  cik: TypeNullable(TypeSecCik()),
  purpose: TypeNullable(Type.String({ maxLength: 1024 })),
  amount: TypeNullable(Type.Number()),
  percent: TypeNullable(Type.Number()),
  note: TypeNullable(Type.String({ maxLength: 2048 })),
  confidence: TypeNullable(Type.Number()),
  source_span: TypeNullable(Type.String()),
  created_at: Type.String(),
});
export type UseOfProceeds = Static<typeof UseOfProceedsSchema>;

export const UseOfProceedsPrimaryKeyNames = [
  "extractor_id",
  "accession_number",
  "line_index",
] as const;

export type UseOfProceedsRepositoryStorage = ITabularStorage<
  typeof UseOfProceedsSchema,
  typeof UseOfProceedsPrimaryKeyNames,
  UseOfProceeds
>;

export const USE_OF_PROCEEDS_REPOSITORY_TOKEN = createServiceToken<UseOfProceedsRepositoryStorage>(
  "sec.storage.useOfProceedsRepository"
);
