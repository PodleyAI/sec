/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * One row per **tenure**: a canonical person holding one title at one company
 * over a date range. `start_date` is the earliest filing date asserting the
 * tenure; `end_date` is null while the role is open and set to the filing date
 * of the first same-scope filing that no longer asserts it (the role ended at
 * or before that date). A person who leaves a role and later regains it has
 * two rows.
 *
 * Tenures are scoped by `(extractor_id, role_scope)`: closure only ever
 * compares a filing against tenures opened by the same roster (e.g. a
 * Form D related-persons roster never closes an S-1 management tenure), so
 * rosters with different completeness semantics cannot cross-contaminate.
 *
 * Rows are resolver-versioned like the address/phone junctions: rebuilt when
 * observations replay at a new person-resolver version, purged by
 * `dropPrevious`.
 */
export const PersonRoleSchema = Type.Object({
  role_id: Type.Integer({
    description: "Synthetic surrogate key; AUTOINCREMENT INTEGER PRIMARY KEY",
    "x-auto-generated": true,
  }),
  canonical_person_id: Type.String({ maxLength: 36 }),
  resolver_version: Type.String({ maxLength: 32 }),
  company_cik: TypeSecCik({
    description: "CIK of the company the role is at (the filing's issuer)",
  }),
  extractor_id: Type.String({
    maxLength: 16,
    description: "Form-mapped extractor id whose filings assert this tenure",
  }),
  role_scope: Type.String({
    maxLength: 64,
    description: "Which list within the extractor (e.g. 'form-d:related-person', 's1:management')",
  }),
  title: Type.String({
    maxLength: 256,
    description: "Single canonical title (display form)",
  }),
  normalized_title: Type.String({
    maxLength: 256,
    description: "Lowercased title; the tenure match key",
  }),
  start_date: Type.String({
    maxLength: 10,
    description: "ISO date of the earliest filing asserting this tenure",
  }),
  start_accession: Type.String({ maxLength: 32 }),
  end_date: TypeNullable(
    Type.String({
      maxLength: 10,
      description: "ISO date the role was determined ended; null = open (current)",
    })
  ),
  end_accession: TypeNullable(Type.String({ maxLength: 32 })),
  last_seen_date: Type.String({
    maxLength: 10,
    description: "ISO date of the latest filing asserting this tenure (closure guard)",
  }),
  last_seen_accession: Type.String({ maxLength: 32 }),
  created_at: Type.String({ description: "ISO 8601 timestamp" }),
});

export type PersonRole = Static<typeof PersonRoleSchema>;

export const PersonRolePrimaryKeyNames = ["role_id"] as const;

export type PersonRoleRepositoryStorage = ITabularStorage<
  typeof PersonRoleSchema,
  typeof PersonRolePrimaryKeyNames,
  PersonRole
>;

export const PERSON_ROLE_REPOSITORY_TOKEN = createServiceToken<PersonRoleRepositoryStorage>(
  "sec.storage.personRoleRepository"
);
