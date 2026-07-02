/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizePerson } from "../storage/person/PersonNormalization";
import { normalizeCompanyName } from "../storage/company/CompanyNormalization";
import type { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import type { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import type { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import type { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import type { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import type { CanonicalPersonPhoneRepo } from "../storage/canonical/CanonicalPersonPhoneRepo";
import type { CanonicalCompanyAddressRepo } from "../storage/canonical/CanonicalCompanyAddressRepo";
import type { CanonicalCompanyPhoneRepo } from "../storage/canonical/CanonicalCompanyPhoneRepo";
import type { PersonResolver } from "./PersonResolver";
import type { CompanyResolver } from "./CompanyResolver";

export interface PersonClaim {
  readonly accession_number: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly observation_index: number;
  readonly source_filing_issuer_cik?: number | null;
  readonly cik?: number | null;
  readonly first_name?: string | null;
  readonly middle_name?: string | null;
  readonly last_name?: string | null;
  readonly suffix?: string | null;
  readonly title?: string | null;
  readonly relationship?: string | null;
  readonly birth_year?: number | null;
  readonly bio?: string | null;
  readonly address_id?: string | null;
  readonly international_number?: string | null;
  readonly source_context?: string | null;
}

export interface CompanyClaim {
  readonly accession_number: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly observation_index: number;
  readonly cik?: number | null;
  readonly crd_number?: string | null;
  readonly name?: string | null;
  readonly jurisdiction?: string | null;
  readonly entity_type?: string | null;
  readonly address_id?: string | null;
  readonly international_number?: string | null;
  readonly source_context?: string | null;
}

interface EntityObserverOptions {
  personObservationRepo: PersonObservationRepo;
  companyObservationRepo: CompanyObservationRepo;
  personIdentityLinkRepo: PersonIdentityLinkRepo;
  companyIdentityLinkRepo: CompanyIdentityLinkRepo;
  personResolver: PersonResolver;
  companyResolver: CompanyResolver;
  canonicalPersonAddressRepo: CanonicalPersonAddressRepo;
  canonicalPersonPhoneRepo: CanonicalPersonPhoneRepo;
  canonicalCompanyAddressRepo: CanonicalCompanyAddressRepo;
  canonicalCompanyPhoneRepo: CanonicalCompanyPhoneRepo;
  activeResolverPersonVersion: string;
  activeResolverCompanyVersion: string;
}

/**
 * Shared helper that form storage modules call to normalize, upsert, resolve,
 * and link person and company observations. Centralizes the observe→resolve→link
 * pipeline so each form storage module doesn't repeat it.
 */
export class EntityObserver {
  constructor(private readonly opts: EntityObserverOptions) {}

  async observePerson(
    claim: PersonClaim
  ): Promise<{ canonical_person_id: string; observation_id: number }> {
    // Re-observing this natural key would blindly +1 the address/phone
    // co-occurrence counts. Remove the prior observation's contribution first
    // so a replay nets out to the same count (idempotent) instead of inflating.
    await this.removePriorPersonJunctions(claim);

    // Normalize name parts into normalized fields
    const fullName = [claim.first_name, claim.middle_name, claim.last_name, claim.suffix]
      .filter(Boolean)
      .join(" ");
    const normalized = fullName
      ? normalizePerson({ name: fullName, cik: claim.cik ?? undefined })
      : undefined;

    const now = new Date().toISOString();

    // Upsert observation row
    const upserted = await this.opts.personObservationRepo.upsertByNaturalKey({
      accession_number: claim.accession_number,
      extractor_id: claim.extractor_id,
      extractor_version: claim.extractor_version,
      observation_index: claim.observation_index,
      source_filing_issuer_cik: claim.source_filing_issuer_cik ?? null,
      cik: claim.cik ?? null,
      first_name: claim.first_name ?? null,
      middle_name: claim.middle_name ?? null,
      last_name: claim.last_name ?? null,
      suffix: claim.suffix ?? null,
      normalized_first: normalized?.first ?? null,
      normalized_middle: normalized?.middle ?? null,
      normalized_last: normalized?.last ?? null,
      normalized_suffix: normalized?.suffix ?? null,
      title: claim.title ?? null,
      relationship: claim.relationship ?? null,
      birth_year: claim.birth_year ?? null,
      bio: claim.bio ?? null,
      raw_address_id: claim.address_id ?? null,
      raw_phone_id: claim.international_number ?? null,
      source_context: claim.source_context ?? null,
      created_at: now,
    });

    // Resolve to canonical person
    const canonical_person_id = await this.opts.personResolver.resolve(upserted);

    // Write identity link
    await this.opts.personIdentityLinkRepo.upsert(
      upserted.observation_id,
      this.opts.activeResolverPersonVersion,
      canonical_person_id
    );

    // Record address and phone junctions
    const seen_at = now;
    if (claim.address_id) {
      await this.opts.canonicalPersonAddressRepo.recordObservation({
        canonical_person_id,
        address_hash_id: claim.address_id,
        resolver_version: this.opts.activeResolverPersonVersion,
        seen_at,
      });
    }
    if (claim.international_number) {
      await this.opts.canonicalPersonPhoneRepo.recordObservation({
        canonical_person_id,
        international_number: claim.international_number,
        resolver_version: this.opts.activeResolverPersonVersion,
        seen_at,
      });
    }

    return { canonical_person_id, observation_id: upserted.observation_id };
  }

  async observeCompany(
    claim: CompanyClaim
  ): Promise<{ canonical_company_id: string; observation_id: number }> {
    // Idempotent replay: drop the prior contribution before re-recording.
    await this.removePriorCompanyJunctions(claim);

    const normalized_name = claim.name ? normalizeCompanyName(claim.name) : null;
    const now = new Date().toISOString();

    // Upsert observation row
    const upserted = await this.opts.companyObservationRepo.upsertByNaturalKey({
      accession_number: claim.accession_number,
      extractor_id: claim.extractor_id,
      extractor_version: claim.extractor_version,
      observation_index: claim.observation_index,
      cik: claim.cik ?? null,
      crd_number: claim.crd_number ?? null,
      name: claim.name ?? null,
      normalized_name,
      jurisdiction: claim.jurisdiction ?? null,
      entity_type: claim.entity_type ?? null,
      raw_address_id: claim.address_id ?? null,
      raw_phone_id: claim.international_number ?? null,
      source_context: claim.source_context ?? null,
      created_at: now,
    });

    // Resolve to canonical company
    const canonical_company_id = await this.opts.companyResolver.resolve(upserted);

    // Write identity link
    await this.opts.companyIdentityLinkRepo.upsert(
      upserted.observation_id,
      this.opts.activeResolverCompanyVersion,
      canonical_company_id
    );

    // Record address and phone junctions
    const seen_at = now;
    if (claim.address_id) {
      await this.opts.canonicalCompanyAddressRepo.recordObservation({
        canonical_company_id,
        address_hash_id: claim.address_id,
        resolver_version: this.opts.activeResolverCompanyVersion,
        seen_at,
      });
    }
    if (claim.international_number) {
      await this.opts.canonicalCompanyPhoneRepo.recordObservation({
        canonical_company_id,
        international_number: claim.international_number,
        resolver_version: this.opts.activeResolverCompanyVersion,
        seen_at,
      });
    }

    return { canonical_company_id, observation_id: upserted.observation_id };
  }

  /**
   * If an observation already exists for this natural key, decrement its
   * address/phone junction contribution at the active resolver version (using
   * its *prior* address/phone + its current link's canonical id) so the
   * subsequent re-record nets out instead of double-counting. No-op on first
   * sight or when the prior observation has no link at the active version.
   */
  private async removePriorPersonJunctions(claim: PersonClaim): Promise<void> {
    const prior = await this.opts.personObservationRepo.getByNaturalKey(
      claim.accession_number,
      claim.extractor_id,
      claim.observation_index
    );
    if (!prior) return;
    const link = await this.opts.personIdentityLinkRepo.getForObservation(
      prior.observation_id,
      this.opts.activeResolverPersonVersion
    );
    if (!link) return;
    if (prior.raw_address_id) {
      await this.opts.canonicalPersonAddressRepo.removeObservation({
        canonical_person_id: link.canonical_person_id,
        address_hash_id: prior.raw_address_id,
        resolver_version: this.opts.activeResolverPersonVersion,
      });
    }
    if (prior.raw_phone_id) {
      await this.opts.canonicalPersonPhoneRepo.removeObservation({
        canonical_person_id: link.canonical_person_id,
        international_number: prior.raw_phone_id,
        resolver_version: this.opts.activeResolverPersonVersion,
      });
    }
  }

  /** Company counterpart of {@link removePriorPersonJunctions}. */
  private async removePriorCompanyJunctions(claim: CompanyClaim): Promise<void> {
    const prior = await this.opts.companyObservationRepo.getByNaturalKey(
      claim.accession_number,
      claim.extractor_id,
      claim.observation_index
    );
    if (!prior) return;
    const link = await this.opts.companyIdentityLinkRepo.getForObservation(
      prior.observation_id,
      this.opts.activeResolverCompanyVersion
    );
    if (!link) return;
    if (prior.raw_address_id) {
      await this.opts.canonicalCompanyAddressRepo.removeObservation({
        canonical_company_id: link.canonical_company_id,
        address_hash_id: prior.raw_address_id,
        resolver_version: this.opts.activeResolverCompanyVersion,
      });
    }
    if (prior.raw_phone_id) {
      await this.opts.canonicalCompanyPhoneRepo.removeObservation({
        canonical_company_id: link.canonical_company_id,
        international_number: prior.raw_phone_id,
        resolver_version: this.opts.activeResolverCompanyVersion,
      });
    }
  }
}
