/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import type { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import type { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import type { PersonObservation } from "../storage/observation/PersonObservationSchema";
import type { CanonicalPerson } from "../storage/canonical/CanonicalPersonSchema";

interface PersonResolverOptions {
  canonicalPersonRepo: CanonicalPersonRepo;
  canonicalPersonAliasRepo: CanonicalPersonAliasRepo;
  activeResolverVersion: string;
}

/**
 * Matches a PersonObservation to an existing canonical person or creates one.
 * Resolution order: CIK fast-path, then normalized-name + issuer-CIK fallback.
 * Delegates alias indirection to CanonicalPersonAliasRepo.
 */
export class PersonResolver {
  constructor(private opts: PersonResolverOptions) {}

  async resolve(obs: PersonObservation): Promise<string> {
    let candidate: CanonicalPerson | undefined;

    if (obs.cik !== null && obs.cik !== undefined) {
      candidate = await this.opts.canonicalPersonRepo.findByResolverAndCik(
        this.opts.activeResolverVersion,
        obs.cik
      );
    } else {
      candidate = await this.opts.canonicalPersonRepo.findByResolverAndName(
        this.opts.activeResolverVersion,
        obs.normalized_first,
        obs.normalized_middle,
        obs.normalized_last,
        obs.normalized_suffix,
        obs.source_filing_issuer_cik
      );
    }

    let candidate_id: string;
    if (candidate) {
      candidate_id = candidate.canonical_person_id;
    } else {
      candidate_id = randomUUID();
      const fresh: CanonicalPerson = {
        canonical_person_id: candidate_id,
        resolver_version: this.opts.activeResolverVersion,
        display_first: obs.first_name,
        display_middle: obs.middle_name,
        display_last: obs.last_name,
        display_suffix: obs.suffix,
        cik: obs.cik,
        normalized_first: obs.normalized_first,
        normalized_middle: obs.normalized_middle,
        normalized_last: obs.normalized_last,
        normalized_suffix: obs.normalized_suffix,
        source_filing_issuer_cik: obs.cik === null ? obs.source_filing_issuer_cik : null,
        created_at: new Date().toISOString(),
      };
      await this.opts.canonicalPersonRepo.create(fresh);
    }

    return await this.opts.canonicalPersonAliasRepo.resolve(candidate_id);
  }
}
