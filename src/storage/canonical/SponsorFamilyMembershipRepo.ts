/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
  type SponsorFamilyMembership,
  type SponsorFamilyMembershipRepositoryStorage,
} from "./SponsorFamilyMembershipSchema";
import { FamilyMembershipRepo } from "./FamilyMembershipRepo";

export class SponsorFamilyMembershipRepo extends FamilyMembershipRepo<SponsorFamilyMembership> {
  constructor(repo?: SponsorFamilyMembershipRepositoryStorage) {
    super(
      repo ?? globalServiceRegistry.get(SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN),
      "canonical_sponsor_family_id"
    );
  }

  async listCompaniesForFamily(
    resolver_version: string,
    canonical_sponsor_family_id: string
  ): Promise<string[]> {
    return super.listCompaniesForFamily(resolver_version, canonical_sponsor_family_id);
  }
}
