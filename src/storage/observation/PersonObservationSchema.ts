/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * One row per person claim made by an extractor for a filing. The natural
 * key `(accession_number, extractor_id, observation_index)` is UNIQUE; re-
 * extraction (same extractor, any version) overwrites in place on the
 * natural key. `extractor_version` is recorded but not part of the key —
 * the most recent extraction wins.
 */
export const PersonObservationSchema = Type.Object({
  observation_id: Type.Integer({
    description: "Synthetic surrogate key; AUTOINCREMENT INTEGER PRIMARY KEY",
    "x-auto-generated": true,
  }),
  accession_number: Type.String({
    maxLength: 32,
    description: "EDGAR accession number of the source filing",
  }),
  extractor_id: Type.String({
    maxLength: 16,
    description: "Form-mapped extractor id (e.g. 'D', 'C', '1-A', '1-K', '1-Z')",
  }),
  extractor_version: Type.String({
    maxLength: 32,
    description: "Semver of the extractor that produced this row",
  }),
  observation_index: Type.Integer({
    minimum: 0,
    description: "Stable per-extractor ordinal within the filing",
  }),
  source_filing_issuer_cik: TypeNullable(
    TypeSecCik({
      description: "CIK of the filing's primary issuer; null if unknown",
    })
  ),
  cik: TypeNullable(TypeSecCik({ description: "Person's own CIK if disclosed" })),
  first_name: TypeNullable(Type.String({ maxLength: 128 })),
  middle_name: TypeNullable(Type.String({ maxLength: 128 })),
  last_name: TypeNullable(Type.String({ maxLength: 128 })),
  suffix: TypeNullable(Type.String({ maxLength: 32 })),
  normalized_first: TypeNullable(Type.String({ maxLength: 128 })),
  normalized_middle: TypeNullable(Type.String({ maxLength: 128 })),
  normalized_last: TypeNullable(Type.String({ maxLength: 128 })),
  normalized_suffix: TypeNullable(Type.String({ maxLength: 32 })),
  // The person's titles live in `person_observation_titles` (one row per single
  // title, keyed by observation_id) — see PersonObservationTitleSchema.
  relationship: TypeNullable(Type.String({ maxLength: 64 })),
  /**
   * Which list inside the form this person was read from, e.g.
   * `form-d:related-person`, `s1:management`. Null for a claim that carries
   * none, which is also a claim that mints no tenure. Two lists never close
   * each other's tenures.
   */
  role_scope: TypeNullable(Type.String({ maxLength: 64 })),
  // Leadership enrichment (embarc-facing). `birth_year` is derived from a stated
  // age in the filing (filing_year − age) so present age stays recomputable;
  // `bio` is the person's biography prose from the management section.
  birth_year: TypeNullable(
    Type.Integer({
      minimum: 1900,
      maximum: 2100,
      description: "Derived from stated age (filing_year − age)",
    })
  ),
  bio: TypeNullable(Type.String({ description: "Biography prose from the management section" })),
  raw_address_id: TypeNullable(Type.String({ maxLength: 512 })),
  raw_phone_id: TypeNullable(Type.String({ maxLength: 32 })),
  source_context: TypeNullable(
    Type.String({
      description: "JSON-encoded parser-specific fields that don't earn a first-class column",
    })
  ),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type PersonObservation = Static<typeof PersonObservationSchema>;

export const PersonObservationPrimaryKeyNames = ["observation_id"] as const;

export type PersonObservationRepositoryStorage = ITabularStorage<
  typeof PersonObservationSchema,
  typeof PersonObservationPrimaryKeyNames,
  PersonObservation
>;

export const PERSON_OBSERVATION_REPOSITORY_TOKEN =
  createServiceToken<PersonObservationRepositoryStorage>("sec.storage.personObservationRepository");
