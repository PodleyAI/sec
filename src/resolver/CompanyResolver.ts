/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from "node:crypto";
import type { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import type { CanonicalCompanyAliasRepo } from "../storage/canonical/CanonicalCompanyAliasRepo";
import type { CompanyObservation } from "../storage/observation/CompanyObservationSchema";
import type { CanonicalCompany } from "../storage/canonical/CanonicalCompanySchema";

interface CompanyResolverOptions {
  canonicalCompanyRepo: CanonicalCompanyRepo;
  canonicalCompanyAliasRepo: CanonicalCompanyAliasRepo;
  activeResolverVersion: string;
}

/**
 * Matches a CompanyObservation to an existing canonical company or creates one.
 * Resolution cascade: CIK → CRD number → normalized name. Throws if none is available.
 * Delegates alias indirection to CanonicalCompanyAliasRepo.
 */
export class CompanyResolver {
  constructor(private opts: CompanyResolverOptions) {}

  async resolve(obs: CompanyObservation): Promise<string> {
    let candidate: CanonicalCompany | undefined;
    let key_kind: "cik" | "crd" | "name";

    if (obs.cik !== null && obs.cik !== undefined) {
      key_kind = "cik";
      candidate = await this.opts.canonicalCompanyRepo.findByResolverAndCik(
        this.opts.activeResolverVersion,
        obs.cik
      );
    } else if (obs.crd_number) {
      key_kind = "crd";
      candidate = await this.opts.canonicalCompanyRepo.findByResolverAndCrd(
        this.opts.activeResolverVersion,
        obs.crd_number
      );
    } else if (obs.normalized_name) {
      key_kind = "name";
      candidate = await this.opts.canonicalCompanyRepo.findByResolverAndName(
        this.opts.activeResolverVersion,
        obs.normalized_name
      );
    } else {
      throw new Error(
        `cannot resolve company observation ${obs.observation_id}: no CIK, CRD, or name`
      );
    }

    let candidate_id: string;
    if (candidate) {
      candidate_id = candidate.canonical_company_id;
    } else {
      candidate_id = randomUUID();
      const fresh: CanonicalCompany = {
        canonical_company_id: candidate_id,
        resolver_version: this.opts.activeResolverVersion,
        display_name: obs.name,
        cik: key_kind === "cik" ? obs.cik : null,
        crd_number: key_kind === "crd" ? obs.crd_number : null,
        normalized_name: key_kind === "name" ? obs.normalized_name : null,
        created_at: new Date().toISOString(),
      };
      await this.opts.canonicalCompanyRepo.create(fresh);
    }

    return await this.opts.canonicalCompanyAliasRepo.resolve(candidate_id);
  }
}
