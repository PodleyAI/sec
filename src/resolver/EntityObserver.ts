/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizePerson, personDisplayParts } from "../storage/person/PersonNormalization";
import { normalizeCompanyName } from "../storage/company/CompanyNormalization";
import { normalizeManagementTitles } from "../sec/forms/registration-statements/s1/normalizeTitle";
import type { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import type { PersonObservationTitleRepo } from "../storage/observation/PersonObservationTitleRepo";
import type { CompanyObservationRepo } from "../storage/observation/CompanyObservationRepo";
import { RoleRosterCompletenessRepo } from "../storage/canonical/RoleRosterCompletenessRepo";

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
 * An observer, which records observations and their titles. The name is kept
 * for the callers that were written against it when there was also a resolving
 * one; recording is now all an observer does.
 */
export type ObserveOnlyEntityObserver = EntityObserver;

/** What recording an observation yields. */
export interface ObservationResult {
  readonly observation_id: number;
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
  const display = personDisplayParts(parts);
  const fullName = display
    ? [display.first, display.middle, display.last, display.suffix, display.credentials]
        .filter(Boolean)
        .join(" ")
    : [parts.first_name, parts.middle_name, parts.last_name, parts.suffix]
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
   * Where roster completeness decisions land, resolved from DI at first use
   * and memoized (`null` once resolution has failed). Best-effort in exactly
   * the way a repo's own DI lookup is: every registry `DefaultDI` and
   * `TestingDI` build registers the token, so a miss means a hand-assembled
   * unit-test registry — and an unrecorded decision reads downstream as "not
   * known to be complete", which closes nothing.
   */
  private completenessRepo: RoleRosterCompletenessRepo | null | undefined;

  constructor(private readonly opts: EntityObserverObservationOptions) {}

  async observePerson(claim: PersonClaim): Promise<ObservationResult> {
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

    // The canonical id this person resolves to, the junction counts their
    // address and phone contribute, and the tenures their titles anchor are
    // all recomputed from what was just written, by a pass over stored
    // observations. The row and its titles are the whole of what is recorded
    // here.
    return { observation_id: upserted.observation_id };
  }

  /**
   * Record whether a filing that enumerates the COMPLETE roster of
   * `(extractor_id, role_scope)` for a company extracted that roster whole.
   * Only storage modules whose filing type genuinely lists the whole roster
   * may call this — for everything else absence means nothing, and the pass
   * that derives tenures closes none from such a filing.
   *
   * `complete` is the caller's own verdict, and it is RECORDED whichever way it
   * went, in `role_roster_completeness`. Deciding it and recording it are the
   * same act on purpose: a caller that weighed completeness and then simply
   * declined to call left the fact nowhere, and a pass reading only the
   * observations cannot tell that filing from a whole roster.
   *
   * Recording it is all this does. It is the one judgement on this path a later
   * pass cannot reconstruct: a person the extractor declined leaves no
   * observation, so nothing else remembers the filing named them. A person who
   * WAS observed but whose titles all filtered away is a different case and
   * needs no verdict — their row and its titles are stored, so the derivation
   * re-reaches the same conclusion on its own.
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
  }): Promise<void> {
    const complete = args.complete ?? true;
    const completenessRepo = this.rosterCompletenessRepo();
    if (completenessRepo !== null) {
      // Best-effort in the same sense the repo's own resolution is, and for a
      // stronger reason: this call is made from inside a form's `store`, whose
      // single containment boundary turns any throw into a filing-level
      // STORE_ERROR dead letter. Failing to WRITE down a completeness verdict
      // must not undo a store that otherwise succeeded — an unrecorded verdict
      // reads downstream as "not known to be complete", which closes nothing.
      try {
        await completenessRepo.record({
          accession_number: args.accession_number,
          extractor_id: args.extractor_id,
          role_scope: args.role_scope,
          company_cik: args.company_cik,
          filing_date: args.filing_date,
          complete,
        });
      } catch (err) {
        console.error(
          `Failed to record roster completeness for ${args.accession_number}@${args.extractor_id}:${args.role_scope}:`,
          err
        );
      }
    }
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

  async observeCompany(claim: CompanyClaim): Promise<ObservationResult> {
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
    return { observation_id: upserted.observation_id };
  }
}
