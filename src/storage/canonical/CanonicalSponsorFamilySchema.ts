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
 * A SPAC sponsor *family* — the common brand (e.g. "Pershing Square Sponsor")
 * above the legal-sponsor company tier. Distinct legal sponsors are members of a
 * family (see SponsorFamilyMembership), not aliases of one another.
 * Resolver natural key (UNIQUE): (resolver_version, normalized_name).
 */
export const CanonicalSponsorFamilySchema = Type.Object({
  canonical_sponsor_family_id: Type.String({ maxLength: 36, description: "UUID v4" }),
  resolver_version: Type.String({
    maxLength: 32,
    description: "Semver of the resolver that produced this row",
  }),
  display_name: TypeNullable(Type.String({ maxLength: 512, description: "As first emitted" })),
  normalized_name: Type.String({
    maxLength: 512,
    description: "Natural key (with resolver_version)",
  }),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});
export type CanonicalSponsorFamily = Static<typeof CanonicalSponsorFamilySchema>;

export const CanonicalSponsorFamilyPrimaryKeyNames = ["canonical_sponsor_family_id"] as const;

export type CanonicalSponsorFamilyRepositoryStorage = ITabularStorage<
  typeof CanonicalSponsorFamilySchema,
  typeof CanonicalSponsorFamilyPrimaryKeyNames,
  CanonicalSponsorFamily
>;

export const CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN =
  createServiceToken<CanonicalSponsorFamilyRepositoryStorage>(
    "sec.storage.canonicalSponsorFamilyRepository"
  );
