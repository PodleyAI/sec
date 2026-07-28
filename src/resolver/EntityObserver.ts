/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizePerson } from "../storage/person/PersonNormalization";
import { normalizeCompanyName } from "../storage/company/CompanyNormalization";
import { normalizeManagementTitles } from "../sec/forms/registration-statements/s1/normalizeTitle";
import type { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import type { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import type { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import type { PersonIdentityLinkRepo } from "../storage/canonical/PersonIdentityLinkRepo";
import type { CompanyIdentityLinkRepo } from "../storage/canonical/CompanyIdentityLinkRepo";
import type { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import type { CanonicalPersonPhoneRepo } from "../storage/canonical/CanonicalPersonPhoneRepo";
import type { CanonicalCompanyAddressRepo } from "../storage/canonical/CanonicalCompanyAddressRepo";
import type { CanonicalCompanyPhoneRepo } from "../storage/canonical/CanonicalCompanyPhoneRepo";
import { personRoleAssertionKey } from "../storage/canonical/PersonRoleRepo";
import type { PersonRoleRepo } from "../storage/canonical/PersonRoleRepo";
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
  /**
   * The titles this one filing asserts. In-memory call convention only —
   * storage is one row per title (`person_observation_title`), never an array.
   */
  readonly titles?: readonly string[] | null;
  readonly relationship?: string | null;
  /**
   * ISO filing date of the source filing. Required (with
   * `source_filing_issuer_cik` and `role_scope`) for dated person-role
   * tenures to be recorded.
   */
  readonly filing_date?: string | null;
  /**
   * Stable population tag for role tenures (e.g. `form-d:related-person`,
   * `s1:management`). Claims without it record titles but no tenure.
   */
  readonly role_scope?: string | null;
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
  personObservationTitleRepo: PersonObservationTitleRepo;
  companyObservationRepo: CompanyObservationRepo;
  personIdentityLinkRepo: PersonIdentityLinkRepo;
  companyIdentityLinkRepo: CompanyIdentityLinkRepo;
  personResolver: PersonResolver;
  companyResolver: CompanyResolver;
  canonicalPersonAddressRepo: CanonicalPersonAddressRepo;
  canonicalPersonPhoneRepo: CanonicalPersonPhoneRepo;
  canonicalCompanyAddressRepo: CanonicalCompanyAddressRepo;
  canonicalCompanyPhoneRepo: CanonicalCompanyPhoneRepo;
  personRoleRepo: PersonRoleRepo;
  activeResolverPersonVersion: string;
  activeResolverCompanyVersion: string;
}

/**
 * Column-width clamp for filer-authored free text. EDGAR name/role fields are
 * unbounded prose — a bank-as-trustee `rptOwnerName` spelling out the full
 * trust instrument runs past `last_name`'s VARCHAR(128), and Form 144's
 * `relationshipToIssuer` join can outgrow `relationship`'s VARCHAR(64) — and
 * one overlong value would otherwise reject the whole filing at the SQL
 * layer ("value too long for type character varying"). Limits mirror the
 * declared maxLengths in PersonObservationSchema / CompanyObservationSchema.
 * Deterministic, so resolver keys derived from clamped values stay stable.
 */
function clamp(s: string | null, max: number): string | null {
  return s != null && s.length > max ? s.slice(0, max) : s;
}

/**
 * Writer-synthesized placeholders that are not job titles ("Signer" is the
 * signature-block fallback, "Authorized Representative" a signing capacity).
 * They stay on the observation's title rows as the raw claim, but minting a
 * dated role tenure from them would fabricate roles the person doesn't hold.
 */
const PLACEHOLDER_TITLES: ReadonlySet<string> = new Set([
  "signer",
  "authorized representative",
  "sales compensation recipient",
  "connection",
]);

/**
 * Shared helper that form storage modules call to normalize, upsert, resolve,
 * and link person and company observations. Centralizes the observe→resolve→link
 * pipeline so each form storage module doesn't repeat it.
 */
export class EntityObserver {
  /**
   * Role-assertion keys accumulated per filing+population, so a roster
   * filing's closure pass ({@link closeUnassertedPersonRoles}) knows which
   * (person, title) pairs the filing DID assert. Keyed by the same tuple the
   * closure runs over.
   */
  private readonly assertedRoleKeys = new Map<string, Set<string>>();

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
      first_name: clamp(claim.first_name ?? null, 128),
      middle_name: clamp(claim.middle_name ?? null, 128),
      last_name: clamp(claim.last_name ?? null, 128),
      suffix: clamp(claim.suffix ?? null, 32),
      normalized_first: clamp(normalized?.first ?? null, 128),
      normalized_middle: clamp(normalized?.middle ?? null, 128),
      normalized_last: clamp(normalized?.last ?? null, 128),
      normalized_suffix: clamp(normalized?.suffix ?? null, 32),
      relationship: clamp(claim.relationship ?? null, 64),
      birth_year: claim.birth_year ?? null,
      bio: claim.bio ?? null,
      raw_address_id: claim.address_id ?? null,
      raw_phone_id: claim.international_number ?? null,
      source_context: claim.source_context ?? null,
      created_at: now,
    });

    // One row per title. Whole-list replacement keeps replays idempotent (a
    // re-extraction with fewer titles must not leave stale rows behind).
    await this.opts.personObservationTitleRepo.replaceForObservation(
      upserted.observation_id,
      claim.titles ?? []
    );

    // Resolve to canonical person
    const canonical_person_id = await this.opts.personResolver.resolve(upserted);

    // Write identity link
    await this.opts.personIdentityLinkRepo.upsert(
      upserted.observation_id,
      this.opts.activeResolverPersonVersion,
      canonical_person_id
    );

    await this.recordPersonRoles(claim, canonical_person_id);

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

  /**
   * Record dated role tenures for a person claim. Requires the filing date
   * (tenure anchor), the issuer CIK (the company side of the role), and a
   * role_scope (the population tag closure compares within); claims missing
   * any of these record titles but no tenure. Titles are canonicalized here
   * (compound split, canonical casing) so `person_role` rows are uniform
   * regardless of writer — the observation child rows keep the verbatim text.
   */
  private async recordPersonRoles(claim: PersonClaim, canonical_person_id: string): Promise<void> {
    const company_cik = claim.source_filing_issuer_cik;
    if (!claim.filing_date || !claim.role_scope || company_cik == null) return;
    const titles = normalizeManagementTitles(claim.titles ?? []).filter(
      (t) => !PLACEHOLDER_TITLES.has(t.toLowerCase())
    );
    if (titles.length === 0) return;

    const groupKey = this.roleGroupKey(
      claim.accession_number,
      claim.extractor_id,
      claim.role_scope,
      company_cik
    );
    let asserted = this.assertedRoleKeys.get(groupKey);
    if (!asserted) {
      asserted = new Set<string>();
      this.assertedRoleKeys.set(groupKey, asserted);
    }
    for (const title of titles) {
      await this.opts.personRoleRepo.recordAssertion({
        canonical_person_id,
        resolver_version: this.opts.activeResolverPersonVersion,
        company_cik,
        extractor_id: claim.extractor_id,
        role_scope: claim.role_scope,
        title,
        filing_date: claim.filing_date,
        accession_number: claim.accession_number,
      });
      asserted.add(personRoleAssertionKey(canonical_person_id, title));
    }
  }

  /**
   * Roster closure: after a filing that enumerates the COMPLETE population of
   * `(extractor_id, role_scope)` for the company has had all its persons
   * observed, close every open tenure in that population the filing did not
   * assert (`end_date = filing_date`). Only storage modules whose filing type
   * genuinely lists the whole population may call this — for everything else,
   * absence means nothing and tenures stay open. Returns the number closed.
   */
  async closeUnassertedPersonRoles(args: {
    readonly accession_number: string;
    readonly extractor_id: string;
    readonly role_scope: string;
    readonly company_cik: number;
    readonly filing_date: string;
  }): Promise<number> {
    const groupKey = this.roleGroupKey(
      args.accession_number,
      args.extractor_id,
      args.role_scope,
      args.company_cik
    );
    return await this.opts.personRoleRepo.closeUnasserted({
      resolver_version: this.opts.activeResolverPersonVersion,
      company_cik: args.company_cik,
      extractor_id: args.extractor_id,
      role_scope: args.role_scope,
      filing_date: args.filing_date,
      accession_number: args.accession_number,
      asserted: this.assertedRoleKeys.get(groupKey) ?? new Set<string>(),
    });
  }

  private roleGroupKey(
    accession_number: string,
    extractor_id: string,
    role_scope: string,
    company_cik: number
  ): string {
    return `${accession_number}\x00${extractor_id}\x00${role_scope}\x00${company_cik}`;
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
      name: clamp(claim.name ?? null, 512),
      normalized_name: clamp(normalized_name, 512),
      jurisdiction: clamp(claim.jurisdiction ?? null, 64),
      entity_type: clamp(claim.entity_type ?? null, 64),
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
