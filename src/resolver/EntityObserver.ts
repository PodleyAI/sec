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
   * storage is one row per title (`person_observation_titles`), never an array.
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
   * Which list inside the form this claim was read from (e.g.
   * `form-d:related-person`, `s1:management`); tenures are keyed
   * `(extractor_id, role_scope)` so one list can never close another's.
   * Claims without it record titles but no tenure.
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
 * A seated board role ("… of the Board of Directors" — not a Nominee) implies
 * a Director role. Asserting the implied "Director" keeps a person's Director
 * tenure continuous when they gain or lose a chairmanship: the canonical form
 * writers supply drops the redundant bare "Director" next to a board-seat
 * title, and without re-adding it here a roster listing "Chairman of the
 * Board of Directors" would close the person's open Director tenure.
 */
function expandBoardSeatDirector(titles: readonly string[]): string[] {
  const out = [...titles];
  if (
    titles.some((t) => /of the board of directors$/i.test(t)) &&
    !titles.some((t) => t.toLowerCase() === "director")
  ) {
    out.push("Director");
  }
  return out;
}

/**
 * The canonical titles one claim's filed titles mint tenures from: compound
 * titles split and canonicalized, placeholders dropped, an implied board
 * directorship re-added. An empty result means the claim names a person the
 * filing's roster is not complete without.
 *
 * Exported so a batch pass over stored observations derives tenures from the
 * SAME code that wrote them — a second implementation that drifted would mint
 * duplicate tenures under titles nothing else produces.
 */
export function canonicalRoleTitles(titles: readonly string[]): readonly string[] {
  return expandBoardSeatDirector(
    normalizeManagementTitles(titles).filter((t) => !PLACEHOLDER_TITLES.has(t.toLowerCase()))
  );
}

/**
 * Shared helper that form storage modules call to normalize, upsert, resolve,
 * and link person and company observations. Centralizes the observe→resolve→link
 * pipeline so each form storage module doesn't repeat it.
 */
/** The name parts a person observation is identified by, as filed. */
export interface PersonNameParts {
  readonly first_name?: string | null;
  readonly middle_name?: string | null;
  readonly last_name?: string | null;
  readonly suffix?: string | null;
  readonly cik?: number | null;
}

/**
 * Derives a person's normalized identity parts from the name as filed.
 *
 * Extracted so the batch re-normalizer (`ResolveObservationsTask` with
 * `renormalize`) recomputes the columns by calling the SAME code that wrote
 * them. A second implementation that drifts from this one would silently
 * re-key half the tier to a generation nothing else produces.
 */
export function normalizePersonNameParts(parts: PersonNameParts): {
  readonly normalized: ReturnType<typeof normalizePerson> | undefined;
  readonly parsedSuffixDisplay: string | null;
} {
  const fullName = [parts.first_name, parts.middle_name, parts.last_name, parts.suffix]
    .filter(Boolean)
    .join(" ");
  const normalized = fullName
    ? normalizePerson({ name: fullName, cik: parts.cik ?? undefined })
    : undefined;

  // Empty string, not null, is what `join` yields for a name carrying neither
  // kind of suffix — so it is normalized back to null rather than stored as a
  // blank that reads like "the filing wrote an empty suffix".
  const parsedSuffixParts = [normalized?.suffix, normalized?.credentials].filter(Boolean);
  return {
    normalized,
    parsedSuffixDisplay: parsedSuffixParts.length > 0 ? parsedSuffixParts.join(", ") : null,
  };
}

export class EntityObserver {
  /**
   * Role-assertion keys accumulated per filing and role_scope, so a
   * complete-roster filing's closure pass ({@link closeUnassertedPersonRoles})
   * knows which (person, title) pairs the filing DID assert. Keyed by the
   * same tuple the closure runs over.
   */
  private readonly assertedRoleKeys = new Map<string, Set<string>>();

  /**
   * Groups where a participating claim contributed no assertions (all titles
   * filtered/empty): the filing names the person, so its roster is incomplete
   * and closure must not run.
   */
  private readonly incompleteRoleGroups = new Set<string>();

  constructor(private readonly opts: EntityObserverOptions) {}

  async observePerson(
    claim: PersonClaim
  ): Promise<{ canonical_person_id: string; observation_id: number }> {
    // Re-observing this natural key would blindly +1 the address/phone
    // co-occurrence counts. Remove the prior observation's contribution first
    // so a replay nets out to the same count (idempotent) instead of inflating.
    await this.removePriorPersonJunctions(claim);

    const { normalized, parsedSuffixDisplay } = normalizePersonNameParts(claim);

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
      // The RAW suffix keeps the filing's annotation whole — generational and
      // credential alike — because this column is display, not identity (only
      // `normalized_suffix` reaches the resolver's match tuple). Extractors that
      // hand over one `full_name` string supply no `claim.suffix`, so without
      // the fallback a parsed-out "CPA" would be dropped entirely now that it no
      // longer rides along in `normalized_suffix`.
      suffix: clamp(claim.suffix ?? parsedSuffixDisplay, 32),
      normalized_first: clamp(normalized?.first ?? null, 128),
      normalized_middle: clamp(normalized?.middle ?? null, 128),
      normalized_last: clamp(normalized?.last ?? null, 128),
      // Generational only — a credential annotates a person, it does not
      // identify one. See `splitSuffixParts`.
      normalized_suffix: clamp(normalized?.suffix ?? null, 32),
      relationship: clamp(claim.relationship ?? null, 64),
      role_scope: claim.role_scope ?? null,
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
   * role_scope (which list the claim was read from, and therefore which
   * tenures closure may compare it against); claims missing any of these
   * record titles but no tenure. Titles are canonicalized here (compound
   * split, canonical casing) so `person_role` rows are uniform regardless of
   * writer — the observation child rows keep the writer's text (trimmed and
   * de-duplicated, not canonicalized).
   */
  private async recordPersonRoles(claim: PersonClaim, canonical_person_id: string): Promise<void> {
    const company_cik = claim.source_filing_issuer_cik;
    if (!claim.filing_date || !claim.role_scope || company_cik == null) return;
    const titles = canonicalRoleTitles(claim.titles ?? []);
    const groupKey = this.roleGroupKey(
      claim.accession_number,
      claim.extractor_id,
      claim.role_scope,
      company_cik
    );
    if (titles.length === 0) {
      // A participating person whose titles all filtered away is still named
      // by the filing: the roster this filing carries is incomplete for
      // closure purposes (their absent assertions would read as departures).
      this.incompleteRoleGroups.add(groupKey);
      return;
    }
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
   * Roster closure: after a filing that enumerates the COMPLETE roster of
   * `(extractor_id, role_scope)` for the company has had all its persons
   * observed, close every open tenure in that roster the filing did not
   * assert (`end_date = filing_date`). Only storage modules whose filing type
   * genuinely lists the whole roster may call this — for everything else,
   * absence means nothing and tenures stay open. Returns the number closed.
   */
  async closeUnassertedPersonRoles(args: {
    readonly accession_number: string;
    readonly extractor_id: string;
    readonly role_scope: string;
    readonly company_cik: number;
    readonly filing_date: string;
  }): Promise<number> {
    if (!args.filing_date) return 0;
    const groupKey = this.roleGroupKey(
      args.accession_number,
      args.extractor_id,
      args.role_scope,
      args.company_cik
    );
    // Closure is the terminal use of the accumulated assertions — consume them
    // so a reused observer never poisons a later pass with stale keys.
    const asserted = this.assertedRoleKeys.get(groupKey);
    this.assertedRoleKeys.delete(groupKey);
    const incomplete = this.incompleteRoleGroups.delete(groupKey);
    // No recorded assertions means nobody observed this roster through this
    // observer (or every title filtered away): treating that as "the filing
    // asserts no one" would mass-close the company's roles. An incomplete
    // group (a named person contributed nothing) is equally unsafe.
    if (incomplete || asserted === undefined || asserted.size === 0) return 0;
    return await this.opts.personRoleRepo.closeUnasserted({
      resolver_version: this.opts.activeResolverPersonVersion,
      company_cik: args.company_cik,
      extractor_id: args.extractor_id,
      role_scope: args.role_scope,
      filing_date: args.filing_date,
      accession_number: args.accession_number,
      asserted,
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
