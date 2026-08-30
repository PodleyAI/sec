/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { CanonicalJunctionRepo } from "./CanonicalJunctionRepo";
import {
  CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
  type CanonicalCompanyPhone,
  type CanonicalCompanyPhoneRepositoryStorage,
} from "./CanonicalJunctionSchemas";

interface CanonicalCompanyPhoneRepoOptions {
  canonicalCompanyPhoneRepository?: CanonicalCompanyPhoneRepositoryStorage;
}

interface RecordCompanyPhoneArgs {
  canonical_company_id: string;
  international_number: string;
  resolver_version: string;
  seen_at: string;
}

/**
 * Company↔phone co-occurrence junction. Logic lives in
 * {@link CanonicalJunctionRepo}; this subclass binds the row type, DI token, and
 * the two composite-PK column names.
 */
export class CanonicalCompanyPhoneRepo extends CanonicalJunctionRepo<CanonicalCompanyPhone> {
  constructor(options: CanonicalCompanyPhoneRepoOptions = {}) {
    super(
      options.canonicalCompanyPhoneRepository ??
        globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN),
      "company-phone",
      "canonical_company_id",
      "international_number"
    );
  }
}
