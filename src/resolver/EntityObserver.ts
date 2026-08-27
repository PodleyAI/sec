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
import { RoleRosterCompletenessRepo } from "../storage/canonical/RoleRosterCompletenessRepo";
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

/** Where an observation and its titles are written, whoever resolves them. */
export interface EntityObserverObservationOptions {
  personObservationRepo: PersonObservationRepo;
  personObservationTitleRepo: PersonObservationTitleRepo;
  companyObservationRepo: CompanyObservationRepo;
}

/**
 * The person half of the resolver tier: what turns a stored observation into
 * a canonical id, an identity link, dated tenures and junction counts.
 */
export interface EntityObserverPersonResolverOptions {
  personIdentityLinkRepo: PersonIdentityLinkRepo;
  personResolver: PersonResolver;
  canonicalPersonAddressRepo: CanonicalPersonAddressRepo;
  canonicalPersonPhoneRepo: CanonicalPersonPhoneRepo;
  personRoleRepo: PersonRoleRepo;
  activeResolverPersonVersion: string;
}

/** The company half of the resolver tier. */
export interface EntityObserverCompanyResolverOptions {
  companyIdentityLinkRepo: CompanyIdentityLinkRepo;
  companyResolver: CompanyResolver;
  canonicalCompanyAddressRepo: CanonicalCompanyAddressRepo;
  canonicalCompanyPhoneRepo: CanonicalCompanyPhoneRepo;
  activeResolverCompanyVersion: string;
}

export interface EntityObserverResolverOptions
  extends EntityObserverPersonResolverOptions, EntityObserverCompanyResolverOptions {}

/**
 * What an observer may be built with. The resolver tier is optional: given it,
 * both observe methods do everything they always have; without it they stop
 * after the observation row and its titles, leaving a canonical id, a link, a
 * junction count and a tenure to a later batch pass over what was stored.
 * Which half is present is read per method, so a person-only caller need not
 * hand over a company resolver it will never use.
 */
export interface EntityObserverOptions
  extends EntityObserverObservationOptions, Partial<EntityObserverResolverOptions> {}

/** An observer carrying the whole resolver tier — how every caller builds one. */
export interface ResolvingEntityObserverOptions
  extends EntityObserverObservationOptions, EntityObserverResolverOptions {}

/** What recording an observation yields with no resolver tier to key it to. */
export interface ObservationResult {
  readonly observation_id: number;
}

export interface ResolvedPersonObservation extends ObservationResult {
  readonly canonical_person_id: string;
}

export interface ResolvedCompanyObservation extends ObservationResult {
  readonly canonical_company_id: string;
}

/**
 * {@link EntityObserver.observePerson}'s result, which is the canonical id and
 * the observation id for an observer holding the person resolver tier, and the
 * observation id alone for one built to record only.
 */
export type ObservePersonResult<TOptions> = TOptions extends EntityObserverPersonResolverOptions
  ? ResolvedPersonObservation
  : ObservationResult;

/** {@link EntityObserver.observeCompany}'s counterpart of {@link ObservePersonResult}. */
export type ObserveCompanyResult<TOptions> = TOptions extends EntityObserverCompanyResolverOptions
  ? ResolvedCompanyObservation
  : ObservationResult;

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

export class EntityObserver<
  TOptions extends EntityObserverOptions = ResolvingEntityObserverOptions,
> {
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

  /**
   * Where roster completeness decisions land, resolved from DI at first use
   * and memoized (`null` once resolution has failed). Best-effort in exactly
   * the way `PersonRoleRepo`'s alias lookup is: every registry `DefaultDI` and
   * `TestingDI` build registers the token, so a miss means a hand-assembled
   * unit-test registry — and an unrecorded decision reads downstream as "not
   * known to be complete", which closes nothing.
   */
  private completenessRepo: RoleRosterCompletenessRepo | null | undefined;

  constructor(private readonly opts: TOptions) {}

  /**
   * The person resolver tier, or undefined when this observer was built to
   * record observations only. The resolver is what the caller either supplied
   * or did not; the rest of the half travels with it.
   */
  private personTier(): EntityObserverPersonResolverOptions | undefined {
    return this.opts.personResolver === undefined
      ? undefined
      : (this.opts as EntityObserverPersonResolverOptions);
  }

  /** Company counterpart of {@link personTier}. */
  private companyTier(): EntityObserverCompanyResolverOptions | undefined {
    return this.opts.companyResolver === undefined
      ? undefined
      : (this.opts as EntityObserverCompanyResolverOptions);
  }

  async observePerson(claim: PersonClaim): Promise<ObservePersonResult<TOptions>> {
    const tier = this.personTier();
    // Re-observing this natural key would blindly +1 the address/phone
    // co-occurrence counts. Remove the prior observation's contribution first
    // so a replay nets out to the same count (idempotent) instead of inflating.
    if (tier !== undefined) await this.removePriorPersonJunctions(claim, tier);

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

    // With no resolver tier there is no canonical id to link the observation
    // to, count a junction against, or anchor a tenure on: the observation row
    // and its titles are the whole of what this observer records.
    if (tier === undefined) {
      return { observation_id: upserted.observation_id } as ObservePersonResult<TOptions>;
    }

    // Resolve to canonical person
    const canonical_person_id = await tier.personResolver.resolve(upserted);

    // Write identity link
    await tier.personIdentityLinkRepo.upsert(
      upserted.observation_id,
      tier.activeResolverPersonVersion,
      canonical_person_id
    );

    await this.recordPersonRoles(claim, canonical_person_id, tier);

    // Record address and phone junctions
    const seen_at = now;
    if (claim.address_id) {
      await tier.canonicalPersonAddressRepo.recordObservation({
        canonical_person_id,
        address_hash_id: claim.address_id,
        resolver_version: tier.activeResolverPersonVersion,
        seen_at,
      });
    }
    if (claim.international_number) {
      await tier.canonicalPersonPhoneRepo.recordObservation({
        canonical_person_id,
        international_number: claim.international_number,
        resolver_version: tier.activeResolverPersonVersion,
        seen_at,
      });
    }

    return {
      canonical_person_id,
      observation_id: upserted.observation_id,
    } as ObservePersonResult<TOptions>;
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
  private async recordPersonRoles(
    claim: PersonClaim,
    canonical_person_id: string,
    tier: EntityObserverPersonResolverOptions
  ): Promise<void> {
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
      await tier.personRoleRepo.recordAssertion({
        canonical_person_id,
        resolver_version: tier.activeResolverPersonVersion,
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
   *
   * `complete` is the caller's own verdict on its extraction of the roster,
   * and it is RECORDED whichever way it went, in `role_roster_completeness`.
   * Deciding it and recording it are the same act on purpose: a caller that
   * weighed completeness and then simply declined to call left the fact
   * nowhere, and a batch pass reading only the observations cannot tell that
   * filing from a whole roster.
   */
  async closeUnassertedPersonRoles(args: {
    readonly accession_number: string;
    readonly extractor_id: string;
    readonly role_scope: string;
    readonly company_cik: number;
    readonly filing_date: string;
    /**
     * Whether the extraction that fed this roster named every role holder the
     * filing lists. False when a named row was declined before it could be
     * observed — a junk name field, an overlong name, a row under a confidence
     * floor: that person is still in the filing, so closing from the remainder
     * would record a departure that never happened.
     *
     * Defaults to true, which is what calling this method has always asserted.
     */
    readonly complete?: boolean;
  }): Promise<number> {
    const complete = args.complete ?? true;
    const tier = this.personTier();
    const completenessRepo = this.rosterCompletenessRepo();
    if (completenessRepo !== null) {
      await completenessRepo.record({
        accession_number: args.accession_number,
        extractor_id: args.extractor_id,
        role_scope: args.role_scope,
        company_cik: args.company_cik,
        filing_date: args.filing_date,
        complete,
      });
    }
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
    // group (a named person contributed nothing) is equally unsafe, and so is
    // a roster the caller already knows it did not extract whole.
    if (!complete || incomplete || asserted === undefined || asserted.size === 0) return 0;
    // An observer with no resolver tier minted no tenure to close either. The
    // decision recorded above is the whole of what it leaves behind, and is
    // what lets a later batch pass close from this filing.
    if (tier === undefined) return 0;
    return await tier.personRoleRepo.closeUnasserted({
      resolver_version: tier.activeResolverPersonVersion,
      company_cik: args.company_cik,
      extractor_id: args.extractor_id,
      role_scope: args.role_scope,
      filing_date: args.filing_date,
      accession_number: args.accession_number,
      asserted,
    });
  }

  private rosterCompletenessRepo(): RoleRosterCompletenessRepo | null {
    if (this.completenessRepo === undefined) {
      try {
        this.completenessRepo = new RoleRosterCompletenessRepo();
      } catch {
        this.completenessRepo = null;
      }
    }
    return this.completenessRepo;
  }

  private roleGroupKey(
    accession_number: string,
    extractor_id: string,
    role_scope: string,
    company_cik: number
  ): string {
    return `${accession_number}\x00${extractor_id}\x00${role_scope}\x00${company_cik}`;
  }

  async observeCompany(claim: CompanyClaim): Promise<ObserveCompanyResult<TOptions>> {
    const tier = this.companyTier();
    // Idempotent replay: drop the prior contribution before re-recording.
    if (tier !== undefined) await this.removePriorCompanyJunctions(claim, tier);

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

    // The company twin of the stop in `observePerson`.
    if (tier === undefined) {
      return { observation_id: upserted.observation_id } as ObserveCompanyResult<TOptions>;
    }

    // Resolve to canonical company
    const canonical_company_id = await tier.companyResolver.resolve(upserted);

    // Write identity link
    await tier.companyIdentityLinkRepo.upsert(
      upserted.observation_id,
      tier.activeResolverCompanyVersion,
      canonical_company_id
    );

    // Record address and phone junctions
    const seen_at = now;
    if (claim.address_id) {
      await tier.canonicalCompanyAddressRepo.recordObservation({
        canonical_company_id,
        address_hash_id: claim.address_id,
        resolver_version: tier.activeResolverCompanyVersion,
        seen_at,
      });
    }
    if (claim.international_number) {
      await tier.canonicalCompanyPhoneRepo.recordObservation({
        canonical_company_id,
        international_number: claim.international_number,
        resolver_version: tier.activeResolverCompanyVersion,
        seen_at,
      });
    }

    return {
      canonical_company_id,
      observation_id: upserted.observation_id,
    } as ObserveCompanyResult<TOptions>;
  }

  /**
   * If an observation already exists for this natural key, decrement its
   * address/phone junction contribution at the active resolver version (using
   * its *prior* address/phone + its current link's canonical id) so the
   * subsequent re-record nets out instead of double-counting. No-op on first
   * sight or when the prior observation has no link at the active version.
   */
  private async removePriorPersonJunctions(
    claim: PersonClaim,
    tier: EntityObserverPersonResolverOptions
  ): Promise<void> {
    const prior = await this.opts.personObservationRepo.getByNaturalKey(
      claim.accession_number,
      claim.extractor_id,
      claim.observation_index
    );
    if (!prior) return;
    const link = await tier.personIdentityLinkRepo.getForObservation(
      prior.observation_id,
      tier.activeResolverPersonVersion
    );
    if (!link) return;
    if (prior.raw_address_id) {
      await tier.canonicalPersonAddressRepo.removeObservation({
        canonical_person_id: link.canonical_person_id,
        address_hash_id: prior.raw_address_id,
        resolver_version: tier.activeResolverPersonVersion,
      });
    }
    if (prior.raw_phone_id) {
      await tier.canonicalPersonPhoneRepo.removeObservation({
        canonical_person_id: link.canonical_person_id,
        international_number: prior.raw_phone_id,
        resolver_version: tier.activeResolverPersonVersion,
      });
    }
  }

  /** Company counterpart of {@link removePriorPersonJunctions}. */
  private async removePriorCompanyJunctions(
    claim: CompanyClaim,
    tier: EntityObserverCompanyResolverOptions
  ): Promise<void> {
    const prior = await this.opts.companyObservationRepo.getByNaturalKey(
      claim.accession_number,
      claim.extractor_id,
      claim.observation_index
    );
    if (!prior) return;
    const link = await tier.companyIdentityLinkRepo.getForObservation(
      prior.observation_id,
      tier.activeResolverCompanyVersion
    );
    if (!link) return;
    if (prior.raw_address_id) {
      await tier.canonicalCompanyAddressRepo.removeObservation({
        canonical_company_id: link.canonical_company_id,
        address_hash_id: prior.raw_address_id,
        resolver_version: tier.activeResolverCompanyVersion,
      });
    }
    if (prior.raw_phone_id) {
      await tier.canonicalCompanyPhoneRepo.removeObservation({
        canonical_company_id: link.canonical_company_id,
        international_number: prior.raw_phone_id,
        resolver_version: tier.activeResolverCompanyVersion,
      });
    }
  }
}
