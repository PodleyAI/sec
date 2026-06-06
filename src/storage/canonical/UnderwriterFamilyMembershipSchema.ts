/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

/** Co-occurrence: an underwriter canonical company belongs to an underwriter family. */
export const UnderwriterFamilyMembershipSchema = Type.Object({
  resolver_version: Type.String({ maxLength: 32 }),
  canonical_company_id: Type.String({ maxLength: 36 }),
  canonical_underwriter_family_id: Type.String({ maxLength: 36 }),
  seen_at: Type.String(),
});
export type UnderwriterFamilyMembership = Static<typeof UnderwriterFamilyMembershipSchema>;

export const UnderwriterFamilyMembershipPrimaryKeyNames = [
  "resolver_version",
  "canonical_company_id",
  "canonical_underwriter_family_id",
] as const;

export type UnderwriterFamilyMembershipRepositoryStorage = ITabularStorage<
  typeof UnderwriterFamilyMembershipSchema,
  typeof UnderwriterFamilyMembershipPrimaryKeyNames,
  UnderwriterFamilyMembership
>;

export const UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN =
  createServiceToken<UnderwriterFamilyMembershipRepositoryStorage>(
    "sec.storage.underwriterFamilyMembershipRepository"
  );
