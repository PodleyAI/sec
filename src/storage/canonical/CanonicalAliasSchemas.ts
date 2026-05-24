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
 * Operator-managed merge of mistakenly-split canonical persons. Any
 * `canonical_person` whose `canonical_person_id` matches `alias_canonical_id`
 * is rewritten to `target_canonical_id` by `PersonResolver`'s final pass.
 *
 * Single-hop only: the alias repo (Task 15) rejects an insert whose
 * `target_canonical_id` is itself an `alias_canonical_id`. Aliases survive
 * resolver-version bumps — they live in their own table, not the canonical
 * table.
 */
export const CanonicalPersonAliasSchema = Type.Object({
  alias_canonical_id: Type.String({
    maxLength: 36,
    description: "UUID v4 — the canonical_person_id being aliased away",
  }),
  target_canonical_id: Type.String({
    maxLength: 36,
    description: "UUID v4 — the canonical_person_id to use instead",
  }),
  reason: TypeNullable(Type.String({ maxLength: 1024 })),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
  created_by: TypeNullable(Type.String({ maxLength: 128 })),
});
export type CanonicalPersonAlias = Static<typeof CanonicalPersonAliasSchema>;
export const CanonicalPersonAliasPrimaryKeyNames = ["alias_canonical_id"] as const;
export type CanonicalPersonAliasRepositoryStorage = ITabularStorage<
  typeof CanonicalPersonAliasSchema,
  typeof CanonicalPersonAliasPrimaryKeyNames,
  CanonicalPersonAlias
>;
export const CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN =
  createServiceToken<CanonicalPersonAliasRepositoryStorage>(
    "sec.storage.canonicalPersonAliasRepository"
  );

/**
 * Operator-managed merge of mistakenly-split canonical companies. Same
 * semantics as CanonicalPersonAliasSchema, applied by CompanyResolver's
 * final pass.
 */
export const CanonicalCompanyAliasSchema = Type.Object({
  alias_canonical_id: Type.String({
    maxLength: 36,
    description: "UUID v4 — the canonical_company_id being aliased away",
  }),
  target_canonical_id: Type.String({
    maxLength: 36,
    description: "UUID v4 — the canonical_company_id to use instead",
  }),
  reason: TypeNullable(Type.String({ maxLength: 1024 })),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
  created_by: TypeNullable(Type.String({ maxLength: 128 })),
});
export type CanonicalCompanyAlias = Static<typeof CanonicalCompanyAliasSchema>;
export const CanonicalCompanyAliasPrimaryKeyNames = ["alias_canonical_id"] as const;
export type CanonicalCompanyAliasRepositoryStorage = ITabularStorage<
  typeof CanonicalCompanyAliasSchema,
  typeof CanonicalCompanyAliasPrimaryKeyNames,
  CanonicalCompanyAlias
>;
export const CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN =
  createServiceToken<CanonicalCompanyAliasRepositoryStorage>(
    "sec.storage.canonicalCompanyAliasRepository"
  );
