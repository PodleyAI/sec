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
 * One row per AI-produced observation, keyed by (kind, observation_id). Keeps
 * confidence + source span out of the shared person/company observation tables
 * so deterministic XML extractors stay column-clean.
 */
export const ObservationProvenanceSchema = Type.Object({
  kind: Type.Union([Type.Literal("person"), Type.Literal("company")], {
    description: "person | company",
  }),
  observation_id: Type.Integer({ description: "FK to the person/company observation row" }),
  confidence: TypeNullable(Type.Number({ description: "0..1 model-reported confidence" })),
  source_span: TypeNullable(
    Type.String({ description: "verbatim text the entity was drawn from" })
  ),
  section_name: TypeNullable(Type.String({ maxLength: 128 })),
  model_id: TypeNullable(Type.String({ maxLength: 128 })),
  prompt_version: TypeNullable(Type.String({ maxLength: 32 })),
  extra: TypeNullable(
    Type.String({ description: "JSON diagnostic overflow; NOT a deferred-data store" })
  ),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type ObservationProvenance = Static<typeof ObservationProvenanceSchema>;

export const ObservationProvenancePrimaryKeyNames = ["kind", "observation_id"] as const;

export type ObservationProvenanceRepositoryStorage = ITabularStorage<
  typeof ObservationProvenanceSchema,
  typeof ObservationProvenancePrimaryKeyNames,
  ObservationProvenance
>;

export const OBSERVATION_PROVENANCE_REPOSITORY_TOKEN =
  createServiceToken<ObservationProvenanceRepositoryStorage>(
    "sec.storage.observationProvenanceRepository"
  );
