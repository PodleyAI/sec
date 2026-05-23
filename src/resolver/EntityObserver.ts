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
  accession_number: string;
  extractor_id: string;
  extractor_version: string;
  observation_index: number;
  source_filing_issuer_cik?: number | null;
  cik?: number | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  suffix?: string | null;
  title?: string | null;
  relationship?: string | null;
  address_id?: string | null;
  international_number?: string | null;
  source_context?: string | null;
}

export interface CompanyClaim {
  accession_number: string;
  extractor_id: string;
  extractor_version: string;
  observation_index: number;
  cik?: number | null;
  crd_number?: string | null;
  name?: string | null;
  jurisdiction?: string | null;
  entity_type?: string | null;
  address_id?: string | null;
  international_number?: string | null;
  source_context?: string | null;
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
  constructor(private opts: EntityObserverOptions) {}

  async observePerson(
    claim: PersonClaim
  ): Promise<{ canonical_person_id: string; observation_id: number }> {
    // Normalize name parts into normalized fields
    const fullName = [claim.first_name, claim.middle_name, claim.last_name, claim.suffix]
      .filter(Boolean)
      .join(" ");
    const normalized = fullName
      ? normalizePerson({ name: fullName, cik: claim.cik ?? undefined })
      : undefined;

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
      raw_address_id: claim.address_id ?? null,
      raw_phone_id: claim.international_number ?? null,
      source_context: claim.source_context ?? null,
      created_at: new Date().toISOString(),
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
    const seen_at = new Date().toISOString();
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
    const normalized_name = claim.name ? normalizeCompanyName(claim.name) : null;

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
      created_at: new Date().toISOString(),
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
    const seen_at = new Date().toISOString();
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
}
