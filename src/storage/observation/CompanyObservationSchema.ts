/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * One row per company claim made by an extractor for a filing. Same natural-
 * key semantics as PersonObservationSchema: (accession_number, extractor_id,
 * observation_index) is UNIQUE; observation_id is the synthetic surrogate
 * key. extractor_version is recorded but not part of the key — re-extraction
 * overwrites in place.
 */
export const CompanyObservationSchema = Type.Object({
  observation_id: Type.Integer({
    description: "Synthetic surrogate key; AUTOINCREMENT INTEGER PRIMARY KEY",
    "x-auto-generated": true,
  }),
  accession_number: Type.String({ maxLength: 32 }),
  extractor_id: Type.String({ maxLength: 16 }),
  extractor_version: Type.String({ maxLength: 32 }),
  observation_index: Type.Integer({ minimum: 0 }),
  cik: TypeNullable(TypeSecCik()),
  crd_number: TypeNullable(Type.String({ maxLength: 32 })),
  name: TypeNullable(Type.String({ maxLength: 512 })),
  normalized_name: TypeNullable(Type.String({ maxLength: 512 })),
  jurisdiction: TypeNullable(Type.String({ maxLength: 64 })),
  entity_type: TypeNullable(Type.String({ maxLength: 64 })),
  raw_address_id: TypeNullable(Type.String({ maxLength: 512 })),
  raw_phone_id: TypeNullable(Type.String({ maxLength: 32 })),
  source_context: TypeNullable(Type.String()),
  created_at: Type.String(),
});

export type CompanyObservation = Static<typeof CompanyObservationSchema>;

export const CompanyObservationPrimaryKeyNames = ["observation_id"] as const;

export type CompanyObservationRepositoryStorage = ITabularStorage<
  typeof CompanyObservationSchema,
  typeof CompanyObservationPrimaryKeyNames,
  CompanyObservation
>;

export const COMPANY_OBSERVATION_REPOSITORY_TOKEN =
  createServiceToken<CompanyObservationRepositoryStorage>(
    "sec.storage.companyObservationRepository"
  );
