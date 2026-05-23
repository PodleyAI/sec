/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

/**
 * Per-observation, per-resolver-version mapping from a person observation
 * to a canonical_person. Same observation can have multiple rows at
 * different resolver versions during a resolver dev cycle; the active
 * slot's semver determines which mapping is "current" via the
 * `current_person_identity_link` view.
 *
 * PK is composite `(observation_id, resolver_version)`. An index on
 * `(canonical_person_id, resolver_version)` is created at DDL time
 * (Task 17) for the reverse direction — "which observations point to this
 * canonical at this resolver version".
 */
export const PersonIdentityLinkSchema = Type.Object({
  observation_id: Type.Integer({
    description: "FK to person_observations(observation_id)",
  }),
  resolver_version: Type.String({
    maxLength: 32,
    description: "Resolver semver under which this mapping was produced",
  }),
  canonical_person_id: Type.String({
    maxLength: 36,
    description: "FK to canonical_person(canonical_person_id)",
  }),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type PersonIdentityLink = Static<typeof PersonIdentityLinkSchema>;

export const PersonIdentityLinkPrimaryKeyNames = [
  "observation_id",
  "resolver_version",
] as const;

export type PersonIdentityLinkRepositoryStorage = ITabularStorage<
  typeof PersonIdentityLinkSchema,
  typeof PersonIdentityLinkPrimaryKeyNames,
  PersonIdentityLink
>;

export const PERSON_IDENTITY_LINK_REPOSITORY_TOKEN =
  createServiceToken<PersonIdentityLinkRepositoryStorage>(
    "sec.storage.personIdentityLinkRepository"
  );
