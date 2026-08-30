/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { CanonicalJunctionRepo } from "./CanonicalJunctionRepo";
import {
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
  type CanonicalPersonAddress,
  type CanonicalPersonAddressRepositoryStorage,
} from "./CanonicalJunctionSchemas";

interface CanonicalPersonAddressRepoOptions {
  canonicalPersonAddressRepository?: CanonicalPersonAddressRepositoryStorage;
}

interface RecordPersonAddressArgs {
  canonical_person_id: string;
  address_hash_id: string;
  resolver_version: string;
  seen_at: string;
}

/**
 * Person↔address co-occurrence junction. All logic lives in
 * {@link CanonicalJunctionRepo}; this subclass only binds the row type, DI
 * token, and the two composite-PK column names, and adapts the named-field
 * public API to the base's generic (idValue, assocValue) methods.
 */
export class CanonicalPersonAddressRepo extends CanonicalJunctionRepo<CanonicalPersonAddress> {
  constructor(options: CanonicalPersonAddressRepoOptions = {}) {
    super(
      options.canonicalPersonAddressRepository ??
        globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN),
      "person-address",
      "canonical_person_id",
      "address_hash_id"
    );
  }
}
