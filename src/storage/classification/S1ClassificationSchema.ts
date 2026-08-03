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

/** Filing-level SPAC classification. `classifier_source` discriminates origin. */
export const S1ClassificationSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  cik: TypeNullable(TypeSecCik()),
  sic: TypeNullable(Type.Integer({ minimum: 0, maximum: 9999 })),
  sic_description: TypeNullable(Type.String({ maxLength: 256 })),
  is_spac: Type.Boolean(),
  classifier_source: Type.String({ maxLength: 32, description: "sgml-header | sic-unknown | ai" }),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});
export type S1Classification = Static<typeof S1ClassificationSchema>;

export const S1ClassificationPrimaryKeyNames = ["extractor_id", "accession_number"] as const;

export type S1ClassificationRepositoryStorage = ITabularStorage<
  typeof S1ClassificationSchema,
  typeof S1ClassificationPrimaryKeyNames,
  S1Classification
>;

export const S1_CLASSIFICATION_REPOSITORY_TOKEN =
  createServiceToken<S1ClassificationRepositoryStorage>("sec.storage.s1ClassificationRepository");
