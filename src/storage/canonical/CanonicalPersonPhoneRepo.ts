/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { CanonicalJunctionRepo } from "./CanonicalJunctionRepo";
import {
  CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
  type CanonicalPersonPhone,
  type CanonicalPersonPhoneRepositoryStorage,
} from "./CanonicalJunctionSchemas";

interface CanonicalPersonPhoneRepoOptions {
  canonicalPersonPhoneRepository?: CanonicalPersonPhoneRepositoryStorage;
}

interface RecordPersonPhoneArgs {
  canonical_person_id: string;
  international_number: string;
  resolver_version: string;
  seen_at: string;
}

/**
 * Person↔phone co-occurrence junction. Logic lives in
 * {@link CanonicalJunctionRepo}; this subclass binds the row type, DI token, and
 * the two composite-PK column names.
 */
export class CanonicalPersonPhoneRepo extends CanonicalJunctionRepo<CanonicalPersonPhone> {
  constructor(options: CanonicalPersonPhoneRepoOptions = {}) {
    super(
      options.canonicalPersonPhoneRepository ??
        globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN),
      "person-phone",
      "canonical_person_id",
      "international_number"
    );
  }

  recordObservation(args: RecordPersonPhoneArgs): Promise<CanonicalPersonPhone> {
    return this.record(
      args.canonical_person_id,
      args.international_number,
      args.resolver_version,
      args.seen_at
    );
  }

  removeObservation(pk: {
    canonical_person_id: string;
    international_number: string;
    resolver_version: string;
  }): Promise<void> {
    return this.remove(pk.canonical_person_id, pk.international_number, pk.resolver_version);
  }

  /**
   * Write one already-aggregated row outright (a projection rebuild's
   * replace path) — see {@link CanonicalJunctionRepo.putRow}.
   */
  replaceAggregate(row: CanonicalPersonPhone): Promise<void> {
    return this.putRow(row);
  }
}
