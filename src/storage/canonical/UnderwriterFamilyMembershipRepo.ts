/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN,
  type UnderwriterFamilyMembership,
  type UnderwriterFamilyMembershipRepositoryStorage,
} from "./UnderwriterFamilyMembershipSchema";
import { FamilyMembershipRepo } from "./FamilyMembershipRepo";

export class UnderwriterFamilyMembershipRepo extends FamilyMembershipRepo<UnderwriterFamilyMembership> {
  constructor(repo?: UnderwriterFamilyMembershipRepositoryStorage) {
    super(
      repo ?? globalServiceRegistry.get(UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN),
      "canonical_underwriter_family_id"
    );
  }

  async listCompaniesForFamily(
    resolver_version: string,
    canonical_underwriter_family_id: string
  ): Promise<string[]> {
    return super.listCompaniesForFamily(resolver_version, canonical_underwriter_family_id);
  }
}
