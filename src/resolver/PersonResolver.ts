/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from "node:crypto";
import type { CanonicalPersonRepo } from "../storage/canonical/CanonicalPersonRepo";
import type { CanonicalPersonAliasRepo } from "../storage/canonical/CanonicalPersonAliasRepo";
import type { PersonObservation } from "../storage/observation/PersonObservationSchema";
import type { CanonicalPerson } from "../storage/canonical/CanonicalPersonSchema";
import { AsyncMutex } from "../util/AsyncMutex";
import { isUniqueConstraintError } from "../util/isUniqueConstraintError";
import { personDisplayParts } from "../storage/person/PersonNormalization";

interface PersonResolverOptions {
  canonicalPersonRepo: CanonicalPersonRepo;
  canonicalPersonAliasRepo: CanonicalPersonAliasRepo;
  activeResolverVersion: string;
}

function personKey(obs: PersonObservation, resolverVersion: string): string {
  if (obs.cik !== null && obs.cik !== undefined) {
    return `${resolverVersion}|cik|${obs.cik}`;
  }
  // Match findByResolverAndName's lookup tuple. The issuer CIK is part of
  // the key so two filings that mention the same normalized name from
  // different issuers do not collide.
  return [
    resolverVersion,
    "name",
    obs.normalized_first ?? "",
    obs.normalized_middle ?? "",
    obs.normalized_last ?? "",
    obs.normalized_suffix ?? "",
    obs.source_filing_issuer_cik ?? "",
  ].join("|");
}

function canonicalIdForKey(key: string): string {
  const hex = createHash("sha256").update(`workglow:person:${key}`).digest("hex").slice(0, 32);
  // RFC 4122-shaped deterministic UUID. The resolver version is in `key`, so
  // each resolver generation still receives a disjoint canonical namespace.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${(
    (parseInt(hex[16], 16) & 0x3) |
    0x8
  ).toString(16)}${hex.slice(17, 20)}-${hex.slice(20)}`;
}

/**
 * The subset of a {@link PersonObservation} the same-filing comparison reads.
 *
 * Narrowed on purpose: the cache below holds one of these per no-CIK
 * observation for as long as its accession stays hot, and a whole observation
 * row carries `bio` — management-section prose that can run to kilobytes per
 * person. Copying only the match columns keeps the cache proportional to the
 * roster rather than to the filing's narrative.
 */
type FilingMatchParts = Pick<
  PersonObservation,
  | "cik"
  | "source_filing_issuer_cik"
  | "normalized_first"
  | "normalized_middle"
  | "normalized_last"
  | "normalized_suffix"
  | "raw_address_id"
  | "raw_phone_id"
>;

function filingMatchParts(obs: PersonObservation): FilingMatchParts {
  return {
    cik: obs.cik,
    source_filing_issuer_cik: obs.source_filing_issuer_cik,
    normalized_first: obs.normalized_first,
    normalized_middle: obs.normalized_middle,
    normalized_last: obs.normalized_last,
    normalized_suffix: obs.normalized_suffix,
    raw_address_id: obs.raw_address_id,
    raw_phone_id: obs.raw_phone_id,
  };
}

type FilingCandidate = {
  parts: FilingMatchParts;
  canonicalPersonId: string;
};

/** The name fields {@link displayCandidate} reads, from an observation or a canonical row. */
type DisplayNameParts = Pick<
  PersonObservation,
  "first_name" | "middle_name" | "last_name" | "suffix"
>;

type DisplayCandidate = Pick<
  CanonicalPerson,
  "display_first" | "display_middle" | "display_last" | "display_suffix"
> & { quality: number; tieBreaker: string };

function displayCandidate(obs: DisplayNameParts): DisplayCandidate {
  const parsed = personDisplayParts(obs);
  const display_first = parsed?.first ?? obs.first_name;
  const display_middle = parsed?.middle ?? obs.middle_name;
  const display_last = parsed?.last ?? obs.last_name;
  const display_suffix =
    [parsed?.suffix, parsed?.credentials].filter(Boolean).join(", ") || obs.suffix;

  let quality = 0;
  if (display_first) quality += 4;
  if (display_last) quality += 4;
  if (display_middle) {
    quality += display_middle.replace(/[^A-Za-z]/g, "").length === 1 ? 2 : 3;
  }
  if (display_suffix) quality += 1;
  if (obs.first_name) quality += 2;
  if (obs.middle_name) quality += 1;
  if (/^\s*\/\s*s\s*\//i.test(obs.last_name ?? "")) quality -= 8;
  if (!obs.first_name && /\s/.test(obs.last_name ?? "")) quality -= 3;

  const tieBreaker = [display_first, display_middle, display_last, display_suffix]
    .filter(Boolean)
    .join(" ");
  return { display_first, display_middle, display_last, display_suffix, quality, tieBreaker };
}

function canonicalDisplayCandidate(row: CanonicalPerson): DisplayCandidate {
  return displayCandidate({
    first_name: row.display_first,
    middle_name: row.display_middle,
    last_name: row.display_last,
    suffix: row.display_suffix,
  });
}

function samePart(a: string | null, b: string | null): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

/**
 * Where the bar sits: exactly on the weakest admissible pair — a first-name
 * spelling variant (4) plus a middle name that is merely not contradictory
 * (4). Everything weaker than that is rejected by `firstNameScore` or
 * `compatibleMiddle` returning null rather than by falling short here, so the
 * address and phone bonuses below never buy admission. What they buy is RANK:
 * a candidate has to beat every other canonical in the filing outright, and
 * those are the signals that break a tie between two otherwise equal ones.
 */
const SAME_FILING_THRESHOLD = 8;

/**
 * A missing part is scored the same as both parts missing, never lower.
 *
 * Absence carries no evidence either way, so charging for it made the scale
 * non-monotonic: "Rob Smith"/"Robert Smith" matched, while "Rob A Smith"
 * against the same "Robert Smith" did not. Strictly MORE information about one
 * side must never make a match less likely.
 */
function compatibleMiddle(a: string | null, b: string | null): number | null {
  if (!a || !b) return 4;
  if (samePart(a, b)) return 6;
  // An initial against a full middle agrees on less than two spelled-out
  // middles do, so it scores between "agrees" and "says nothing".
  if (a[0]?.toLowerCase() === b[0]?.toLowerCase() && (a.length === 1 || b.length === 1)) return 5;
  return null;
}

function firstNameScore(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return 8;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  if (shorter.length >= 3 && longer.startsWith(shorter) && longer.length - shorter.length <= 3) {
    return 4;
  }
  return null;
}

/**
 * Conservative evidence score used only among observations in one filing.
 *
 * Suffixes are treated as a disagreement whenever the two sides do not carry
 * the SAME one, absence included. A filing that writes both "Nora Nocik" and
 * "Nora Nocik Jr." is the father-and-son case — the one place a roster spells
 * a distinction out — so reading the missing suffix as "no information" merges
 * exactly the two people the filing bothered to tell apart.
 */
function sameFilingScore(a: FilingMatchParts, b: FilingMatchParts): number | null {
  if (a.cik !== null || b.cik !== null) return null;
  if (a.source_filing_issuer_cik !== b.source_filing_issuer_cik) return null;
  if (!a.normalized_last || !b.normalized_last || !samePart(a.normalized_last, b.normalized_last)) {
    return null;
  }
  if (!samePart(a.normalized_suffix, b.normalized_suffix)) return null;
  const first = firstNameScore(a.normalized_first, b.normalized_first);
  const middle = compatibleMiddle(a.normalized_middle, b.normalized_middle);
  if (first === null || middle === null) return null;

  // `relationship` is deliberately NOT scored: it names the KIND of relation
  // ("form-c:signature"), so it is identical for every signer of a filing and
  // discriminates between none of them. Address and phone are person-specific,
  // so they stay.
  let score = first + middle;
  if (a.raw_address_id && a.raw_address_id === b.raw_address_id) score += 2;
  if (a.raw_phone_id && a.raw_phone_id === b.raw_phone_id) score += 2;
  return score >= SAME_FILING_THRESHOLD ? score : null;
}

/**
 * Matches a PersonObservation to an existing canonical person or creates one.
 * Resolution order: CIK fast-path, then normalized-name + issuer-CIK fallback.
 * Delegates alias indirection to CanonicalPersonAliasRepo.
 *
 * Concurrency: two `resolve()` calls that map to the same identity used to
 * race — both observed no canonical row, both
 * minted a fresh UUID, both inserted, yielding two distinct canonical ids
 * for what should have been the same person. We now serialise the
 * find-or-create critical section per key with an `AsyncMutex`,
 * kept alive for as long as any caller still holds or is queued behind it
 * via a simple refcount. Once the count drops to zero the entry is
 * removed from the map so the map stays bounded for long-running
 * processes that resolve millions of distinct keys.
 *
 * The alias-resolution lookup also runs inside the mutex so the queued
 * caller observes both the canonical row and its alias resolution, so
 * concurrent resolves converge to the same final canonical_person_id
 * even when one races an alias rewrite that happens between the create
 * and the alias lookup.
 *
 * The mutex map is instance-scoped: CIK identities use per-key mutexes and
 * no-CIK observations use a per-accession mutex so spelling variants cannot
 * race one another. Multi-instance / multi-process CIK contention is collapsed
 * by the storage UNIQUE constraint on (resolver_version, cik). The name path
 * has no such constraint — a name tuple is not unique, by design — so it
 * converges on a deterministic primary key instead, adopting an existing row
 * rather than writing over it. Every production call site constructs one
 * resolver and reuses it for the duration of its work (a filing
 * extraction, a CLI batch resolve), so intra-instance serialisation
 * covers all observations sharing a scope.
 */
export class PersonResolver {
  private readonly _keyMutexes = new Map<string, { mutex: AsyncMutex; refs: number }>();
  private readonly _filingCandidates = new Map<string, FilingCandidate[]>();
  private static readonly MAX_CACHED_FILINGS = 1_000;

  constructor(private opts: PersonResolverOptions) {}

  async resolve(obs: PersonObservation): Promise<string> {
    // All no-CIK observations in one accession share a lock so compatible
    // variants cannot concurrently mint separate canonicals.
    const key =
      obs.cik === null
        ? `${this.opts.activeResolverVersion}|filing|${obs.accession_number}`
        : personKey(obs, this.opts.activeResolverVersion);
    let entry = this._keyMutexes.get(key);
    if (entry === undefined) {
      entry = { mutex: new AsyncMutex(), refs: 0 };
      this._keyMutexes.set(key, entry);
    }
    entry.refs += 1;

    let resolvedId: string;
    try {
      resolvedId = await entry.mutex.lock(async () => {
        // Inside the critical section we re-query so any queued caller
        // that ran before us picks up the canonical row they just
        // inserted.
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

        // Exact normalized lookup remains authoritative. Only if it misses do
        // we consider variants already seen in this same accession, and only a
        // unique best-scoring canonical is accepted.
        if (!candidate && obs.cik === null) {
          const bestByCanonical = new Map<string, { seen: FilingCandidate; score: number }>();
          const parts = filingMatchParts(obs);
          for (const seen of this._filingCandidates.get(obs.accession_number) ?? []) {
            const score = sameFilingScore(parts, seen.parts);
            if (score === null) continue;
            const prior = bestByCanonical.get(seen.canonicalPersonId);
            if (!prior || score > prior.score) {
              bestByCanonical.set(seen.canonicalPersonId, { seen, score });
            }
          }
          const scored = [...bestByCanonical.values()].sort((a, b) => b.score - a.score);
          if (scored[0] && (!scored[1] || scored[0].score > scored[1].score)) {
            candidate = await this.opts.canonicalPersonRepo.getById(
              scored[0].seen.canonicalPersonId
            );
          }
        }

        if (!candidate && obs.cik === null) {
          // The name-keyed id is a pure function of the identity key, so a
          // writer in another process that already minted this person left a
          // row under exactly this id. `create` is an upsert on the primary
          // key (`put`), and the name tuple carries no UNIQUE constraint to
          // turn that into a losable race — so without this read the second
          // writer would overwrite the first, resetting `created_at` and
          // discarding a display name an earlier observation had upgraded.
          candidate = await this.opts.canonicalPersonRepo.getById(
            canonicalIdForKey(personKey(obs, this.opts.activeResolverVersion))
          );
        }

        let candidateId: string;
        let candidateRow: CanonicalPerson | undefined;
        if (candidate) {
          candidateId = candidate.canonical_person_id;
          candidateRow = candidate;
        } else {
          // The deterministic id is what lets the read above find another
          // process's row; the CIK path keeps a random UUID because its
          // UNIQUE constraint already collapses that race.
          const freshId =
            obs.cik === null
              ? canonicalIdForKey(personKey(obs, this.opts.activeResolverVersion))
              : randomUUID();
          const display = displayCandidate(obs);
          const fresh: CanonicalPerson = {
            canonical_person_id: freshId,
            resolver_version: this.opts.activeResolverVersion,
            display_first: display.display_first,
            display_middle: display.display_middle,
            display_last: display.display_last,
            display_suffix: display.display_suffix,
            cik: obs.cik,
            normalized_first: obs.normalized_first,
            normalized_middle: obs.normalized_middle,
            normalized_last: obs.normalized_last,
            normalized_suffix: obs.normalized_suffix,
            source_filing_issuer_cik: obs.cik === null ? obs.source_filing_issuer_cik : null,
            created_at: new Date().toISOString(),
          };
          try {
            await this.opts.canonicalPersonRepo.create(fresh);
            candidateId = freshId;
            candidateRow = fresh;
          } catch (err) {
            // A concurrent writer in a different process / resolver
            // instance won the UNIQUE constraint race. Re-query so we
            // converge on the winner's canonical id instead of failing.
            if (!isUniqueConstraintError(err)) throw err;
            let winner: CanonicalPerson | undefined;
            if (obs.cik !== null && obs.cik !== undefined) {
              winner = await this.opts.canonicalPersonRepo.findByResolverAndCik(
                this.opts.activeResolverVersion,
                obs.cik
              );
            } else {
              winner = await this.opts.canonicalPersonRepo.findByResolverAndName(
                this.opts.activeResolverVersion,
                obs.normalized_first,
                obs.normalized_middle,
                obs.normalized_last,
                obs.normalized_suffix,
                obs.source_filing_issuer_cik
              );
            }
            if (winner === undefined) throw err;
            candidateId = winner.canonical_person_id;
            candidateRow = winner;
          }
        }

        // Resolve the alias INSIDE the mutex so a concurrent caller that
        // queues behind us cannot observe the freshly-minted candidate
        // before the alias rewrite is applied. Without this, two parallel
        // resolves could split: one returns the alias target, the other
        // returns the pre-alias id.
        const finalId = await this.opts.canonicalPersonAliasRepo.resolve(candidateId);
        // BEFORE the display upgrade, not after: an aliased candidate is a
        // retired row that no consumer reads, so upgrading it would improve a
        // tombstone and leave the surviving person stuck with whichever name
        // its own first observation happened to file.
        if (finalId !== candidateId) {
          candidateRow = await this.opts.canonicalPersonRepo.getById(finalId);
        }
        if (candidateRow) {
          await this.upgradeDisplay(candidateRow, obs);
        }
        if (obs.cik === null) this.rememberFilingCandidate(obs, finalId);
        return finalId;
      });
    } finally {
      entry.refs -= 1;
      if (entry.refs === 0) {
        // Same identity check guards against a race where another caller
        // recreated the entry after we decremented but before this line.
        const current = this._keyMutexes.get(key);
        if (current === entry) {
          this._keyMutexes.delete(key);
        }
      }
    }

    return resolvedId;
  }

  /**
   * Replaces the canonical row's display name when this observation carries a
   * more complete reading of it, so the first observation processed does not
   * permanently own the name. Ties break on the lower-sorting name purely to
   * keep the outcome independent of processing order.
   */
  private async upgradeDisplay(row: CanonicalPerson, obs: PersonObservation): Promise<void> {
    const currentDisplay = canonicalDisplayCandidate(row);
    const nextDisplay = displayCandidate(obs);
    const better =
      nextDisplay.quality > currentDisplay.quality ||
      (nextDisplay.quality === currentDisplay.quality &&
        nextDisplay.tieBreaker.localeCompare(currentDisplay.tieBreaker) < 0);
    if (!better) return;
    await this.opts.canonicalPersonRepo.save({
      ...row,
      display_first: nextDisplay.display_first,
      display_middle: nextDisplay.display_middle,
      display_last: nextDisplay.display_last,
      display_suffix: nextDisplay.display_suffix,
    });
  }

  private rememberFilingCandidate(obs: PersonObservation, canonicalPersonId: string): void {
    let candidates = this._filingCandidates.get(obs.accession_number);
    if (!candidates) {
      if (this._filingCandidates.size >= PersonResolver.MAX_CACHED_FILINGS) {
        const oldest = this._filingCandidates.keys().next().value as string | undefined;
        if (oldest) this._filingCandidates.delete(oldest);
      }
      candidates = [];
      this._filingCandidates.set(obs.accession_number, candidates);
    }
    candidates.push({ parts: filingMatchParts(obs), canonicalPersonId });
  }
}
