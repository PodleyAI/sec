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
 * Canonical company identity. PK is `canonical_company_id` (UUID v4 string,
 * minted by CompanyResolver). Multiple resolver versions can coexist;
 * `resolver_version` disambiguates. The `current_canonical_company` view
 * filters to the active resolver slot.
 *
 * Resolver natural keys (enforced as UNIQUE constraints in DDL):
 *   - (resolver_version, cik)          — CIK fast-path
 *   - (resolver_version, crd_number)   — CRD fast-path for broker-dealers
 *   - (resolver_version, normalized_name) — name fallback (no issuer scoping)
 */
export const CanonicalCompanySchema = Type.Object({
  canonical_company_id: Type.String({
    maxLength: 36,
    description: "UUID v4",
  }),
  resolver_version: Type.String({
    maxLength: 32,
    description: "Semver of the resolver that produced this row",
  }),
  display_name: TypeNullable(Type.String({ maxLength: 512 })),
  cik: TypeNullable(TypeSecCik({ description: "Set only when CIK-keyed" })),
  crd_number: TypeNullable(
    Type.String({
      maxLength: 32,
      description: "Set only when CRD-keyed (no CIK)",
    })
  ),
  normalized_name: TypeNullable(
    Type.String({
      maxLength: 512,
      description: "Set only when name-keyed (no CIK, no CRD)",
    })
  ),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type CanonicalCompany = Static<typeof CanonicalCompanySchema>;

export const CanonicalCompanyPrimaryKeyNames = ["canonical_company_id"] as const;

export type CanonicalCompanyRepositoryStorage = ITabularStorage<
  typeof CanonicalCompanySchema,
  typeof CanonicalCompanyPrimaryKeyNames,
  CanonicalCompany
>;

export const CANONICAL_COMPANY_REPOSITORY_TOKEN =
  createServiceToken<CanonicalCompanyRepositoryStorage>(
    "sec.storage.canonicalCompanyRepository"
  );
