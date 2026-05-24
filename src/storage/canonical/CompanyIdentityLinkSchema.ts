/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

/**
 * Per-observation, per-resolver-version mapping from a company observation
 * to a canonical_company. Same observation can have multiple rows at
 * different resolver versions during a resolver dev cycle; the active
 * slot's semver determines which mapping is "current" via the
 * `current_company_identity_link` view.
 *
 * PK is composite `(observation_id, resolver_version)`. An index on
 * `(canonical_company_id, resolver_version)` is created at DDL time
 * (Task 17) for the reverse direction — "which observations point to this
 * canonical at this resolver version".
 */
export const CompanyIdentityLinkSchema = Type.Object({
  observation_id: Type.Integer({
    description: "FK to company_observations(observation_id)",
  }),
  resolver_version: Type.String({
    maxLength: 32,
    description: "Resolver semver under which this mapping was produced",
  }),
  canonical_company_id: Type.String({
    maxLength: 36,
    description: "FK to canonical_company(canonical_company_id)",
  }),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type CompanyIdentityLink = Static<typeof CompanyIdentityLinkSchema>;

export const CompanyIdentityLinkPrimaryKeyNames = [
  "observation_id",
  "resolver_version",
] as const;

export type CompanyIdentityLinkRepositoryStorage = ITabularStorage<
  typeof CompanyIdentityLinkSchema,
  typeof CompanyIdentityLinkPrimaryKeyNames,
  CompanyIdentityLink
>;

export const COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN =
  createServiceToken<CompanyIdentityLinkRepositoryStorage>(
    "sec.storage.companyIdentityLinkRepository"
  );
