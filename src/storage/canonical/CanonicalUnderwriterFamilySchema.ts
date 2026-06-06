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
 * An underwriter *family* — the bank brand (e.g. "Goldman Sachs") above the
 * legal-entity company tier. Subsidiaries are members of a family (see
 * UnderwriterFamilyMembership), not aliases of one another.
 * Resolver natural key (UNIQUE): (resolver_version, normalized_name).
 */
export const CanonicalUnderwriterFamilySchema = Type.Object({
  canonical_underwriter_family_id: Type.String({ maxLength: 36, description: "UUID v4" }),
  resolver_version: Type.String({ maxLength: 32 }),
  display_name: TypeNullable(Type.String({ maxLength: 512 })),
  normalized_name: Type.String({ maxLength: 512 }),
  created_at: Type.String(),
});
export type CanonicalUnderwriterFamily = Static<typeof CanonicalUnderwriterFamilySchema>;

export const CanonicalUnderwriterFamilyPrimaryKeyNames = [
  "canonical_underwriter_family_id",
] as const;

export type CanonicalUnderwriterFamilyRepositoryStorage = ITabularStorage<
  typeof CanonicalUnderwriterFamilySchema,
  typeof CanonicalUnderwriterFamilyPrimaryKeyNames,
  CanonicalUnderwriterFamily
>;

export const CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN =
  createServiceToken<CanonicalUnderwriterFamilyRepositoryStorage>(
    "sec.storage.canonicalUnderwriterFamilyRepository"
  );
