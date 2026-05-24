/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Canonical person identity. PK is `canonical_person_id` (UUID v4 string,
 * minted by PersonResolver). Multiple resolver versions can write distinct
 * rows for the same logical person; `resolver_version` disambiguates. The
 * `current_canonical_person` view filters to the active resolver slot.
 *
 * Resolver natural keys (enforced as UNIQUE constraints in DDL — Task 17):
 *   - (resolver_version, cik) — when the observation carried a CIK
 *   - (resolver_version, normalized_first, normalized_middle, normalized_last,
 *      normalized_suffix, source_filing_issuer_cik) — name-keyed fallback
 */
export const CanonicalPersonSchema = Type.Object({
  canonical_person_id: Type.String({
    maxLength: 36,
    description: "UUID v4",
  }),
  resolver_version: Type.String({
    maxLength: 32,
    description: "Semver of the resolver that produced this row",
  }),
  display_first: TypeNullable(Type.String({ maxLength: 128 })),
  display_middle: TypeNullable(Type.String({ maxLength: 128 })),
  display_last: TypeNullable(Type.String({ maxLength: 128 })),
  display_suffix: TypeNullable(Type.String({ maxLength: 32 })),
  cik: TypeNullable(TypeSecCik({ description: "Set only when the canonical was CIK-keyed" })),
  normalized_first: TypeNullable(Type.String({ maxLength: 128 })),
  normalized_middle: TypeNullable(Type.String({ maxLength: 128 })),
  normalized_last: TypeNullable(Type.String({ maxLength: 128 })),
  normalized_suffix: TypeNullable(Type.String({ maxLength: 32 })),
  source_filing_issuer_cik: TypeNullable(
    TypeSecCik({
      description:
        "Set only when the canonical was name-keyed; scopes name fallback to one issuer",
    })
  ),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type CanonicalPerson = Static<typeof CanonicalPersonSchema>;

export const CanonicalPersonPrimaryKeyNames = ["canonical_person_id"] as const;

export type CanonicalPersonRepositoryStorage = ITabularStorage<
  typeof CanonicalPersonSchema,
  typeof CanonicalPersonPrimaryKeyNames,
  CanonicalPerson
>;

export const CANONICAL_PERSON_REPOSITORY_TOKEN =
  createServiceToken<CanonicalPersonRepositoryStorage>(
    "sec.storage.canonicalPersonRepository"
  );
