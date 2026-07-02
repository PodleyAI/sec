/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { CanonicalJunctionRepo } from "./CanonicalJunctionRepo";
import {
  CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
  type CanonicalCompanyAddress,
  type CanonicalCompanyAddressRepositoryStorage,
} from "./CanonicalJunctionSchemas";

interface CanonicalCompanyAddressRepoOptions {
  canonicalCompanyAddressRepository?: CanonicalCompanyAddressRepositoryStorage;
}

interface RecordCompanyAddressArgs {
  canonical_company_id: string;
  address_hash_id: string;
  resolver_version: string;
  seen_at: string;
}

/**
 * Company↔address co-occurrence junction. Logic lives in
 * {@link CanonicalJunctionRepo}; this subclass binds the row type, DI token, and
 * the two composite-PK column names.
 */
export class CanonicalCompanyAddressRepo extends CanonicalJunctionRepo<CanonicalCompanyAddress> {
  constructor(options: CanonicalCompanyAddressRepoOptions = {}) {
    super(
      options.canonicalCompanyAddressRepository ??
        globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN),
      "company-address",
      "canonical_company_id",
      "address_hash_id"
    );
  }

  recordObservation(args: RecordCompanyAddressArgs): Promise<CanonicalCompanyAddress> {
    return this.record(
      args.canonical_company_id,
      args.address_hash_id,
      args.resolver_version,
      args.seen_at
    );
  }

  removeObservation(pk: {
    canonical_company_id: string;
    address_hash_id: string;
    resolver_version: string;
  }): Promise<void> {
    return this.remove(pk.canonical_company_id, pk.address_hash_id, pk.resolver_version);
  }
}
