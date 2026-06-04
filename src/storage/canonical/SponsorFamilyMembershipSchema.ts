/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";

/** Co-occurrence: a legal-sponsor canonical company belongs to a sponsor family. */
export const SponsorFamilyMembershipSchema = Type.Object({
  resolver_version: Type.String({ maxLength: 32 }),
  canonical_company_id: Type.String({ maxLength: 36 }),
  canonical_sponsor_family_id: Type.String({ maxLength: 36 }),
  seen_at: Type.String(),
});
export type SponsorFamilyMembership = Static<typeof SponsorFamilyMembershipSchema>;

export const SponsorFamilyMembershipPrimaryKeyNames = [
  "resolver_version",
  "canonical_company_id",
  "canonical_sponsor_family_id",
] as const;

export type SponsorFamilyMembershipRepositoryStorage = ITabularStorage<
  typeof SponsorFamilyMembershipSchema,
  typeof SponsorFamilyMembershipPrimaryKeyNames,
  SponsorFamilyMembership
>;

export const SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN =
  createServiceToken<SponsorFamilyMembershipRepositoryStorage>(
    "sec.storage.sponsorFamilyMembershipRepository"
  );
