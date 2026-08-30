/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Operator-managed merge of AI-emitted sponsor-family name variants. Same
 * single-hop semantics as the person/company alias schemas.
 */
export const CanonicalSponsorFamilyAliasSchema = Type.Object({
  alias_canonical_id: Type.String({
    maxLength: 36,
    description: "UUID v4 — the canonical_sponsor_family_id being aliased away",
  }),
  target_canonical_id: Type.String({
    maxLength: 36,
    description: "UUID v4 — the canonical_sponsor_family_id to use instead",
  }),
  reason: TypeNullable(Type.String({ maxLength: 1024 })),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
  created_by: TypeNullable(Type.String({ maxLength: 128 })),
});
export type CanonicalSponsorFamilyAlias = Static<typeof CanonicalSponsorFamilyAliasSchema>;
export const CanonicalSponsorFamilyAliasPrimaryKeyNames = ["alias_canonical_id"] as const;
export type CanonicalSponsorFamilyAliasRepositoryStorage = ITabularStorage<
  typeof CanonicalSponsorFamilyAliasSchema,
  typeof CanonicalSponsorFamilyAliasPrimaryKeyNames,
  CanonicalSponsorFamilyAlias
>;
export const CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN =
  createServiceToken<CanonicalSponsorFamilyAliasRepositoryStorage>(
    "sec.storage.canonicalSponsorFamilyAliasRepository"
  );

/**
 * Operator-managed merge of AI-emitted underwriter-family name variants. Same
 * single-hop semantics as the sponsor-family alias schema.
 */
export const CanonicalUnderwriterFamilyAliasSchema = Type.Object({
  alias_canonical_id: Type.String({ maxLength: 36 }),
  target_canonical_id: Type.String({ maxLength: 36 }),
  reason: TypeNullable(Type.String({ maxLength: 1024 })),
  created_at: Type.String(),
  created_by: TypeNullable(Type.String({ maxLength: 128 })),
});
export type CanonicalUnderwriterFamilyAlias = Static<typeof CanonicalUnderwriterFamilyAliasSchema>;
export const CanonicalUnderwriterFamilyAliasPrimaryKeyNames = ["alias_canonical_id"] as const;
export type CanonicalUnderwriterFamilyAliasRepositoryStorage = ITabularStorage<
  typeof CanonicalUnderwriterFamilyAliasSchema,
  typeof CanonicalUnderwriterFamilyAliasPrimaryKeyNames,
  CanonicalUnderwriterFamilyAlias
>;
export const CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN =
  createServiceToken<CanonicalUnderwriterFamilyAliasRepositoryStorage>(
    "sec.storage.canonicalUnderwriterFamilyAliasRepository"
  );
