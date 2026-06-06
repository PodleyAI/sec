/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable } from "../../util/TypeBoxUtil";

/** Underwriter role detail. Stored as text; values follow this `as const` set. */
export const UNDERWRITER_ROLES = ["lead", "bookrunner", "co-manager", "underwriter"] as const;
export type UnderwriterRole = (typeof UNDERWRITER_ROLES)[number];

/** Per-filing fact: a SPAC/IPO issuer (raw CIK) is underwritten by a bank + family. */
export const UnderwriterLinkSchema = Type.Object({
  accession_number: Type.String({ maxLength: 25 }),
  extractor_id: Type.String({ maxLength: 16 }),
  observation_index: Type.Integer(),
  issuer_cik: TypeSecCik(),
  underwriter_canonical_company_id: Type.String({ maxLength: 36 }),
  underwriter_family_id: Type.String({ maxLength: 36 }),
  role_detail: TypeNullable(Type.String({ maxLength: 32 })),
  shares_allocated: TypeNullable(Type.Integer()),
  over_allotment_shares: TypeNullable(Type.Integer()),
  resolver_version: Type.String({ maxLength: 32 }),
});
export type UnderwriterLink = Static<typeof UnderwriterLinkSchema>;

export const UnderwriterLinkPrimaryKeyNames = [
  "accession_number",
  "extractor_id",
  "observation_index",
] as const;

export type UnderwriterLinkRepositoryStorage = ITabularStorage<
  typeof UnderwriterLinkSchema,
  typeof UnderwriterLinkPrimaryKeyNames,
  UnderwriterLink
>;

export const UNDERWRITER_LINK_REPOSITORY_TOKEN =
  createServiceToken<UnderwriterLinkRepositoryStorage>("sec.storage.underwriterLinkRepository");
