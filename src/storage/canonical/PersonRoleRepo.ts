/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import { KeyedMutex } from "../../util/KeyedMutex";
import { CanonicalPersonAliasRepo } from "./CanonicalPersonAliasRepo";
import {
  PERSON_ROLE_REPOSITORY_TOKEN,
  type PersonRole,
  type PersonRoleRepositoryStorage,
} from "./PersonRoleSchema";

interface PersonRoleRepoOptions {
  personRoleRepository?: PersonRoleRepositoryStorage;
  canonicalPersonAliasRepo?: CanonicalPersonAliasRepo;
}

/**
 * Serialises read-modify-write per tenure natural key. Single-process only —
 * same caveat as the junction repos' lock.
 */
const tenureLocks = new KeyedMutex<string>();

export interface PersonRoleAssertionArgs {
  readonly canonical_person_id: string;
  readonly resolver_version: string;
  readonly company_cik: number;
  readonly extractor_id: string;
  readonly role_scope: string;
  /** Canonical display title; the match key is its lowercased form. */
  readonly title: string;
  /** ISO filing date of the asserting filing. */
  readonly filing_date: string;
  readonly accession_number: string;
}

export interface CloseUnassertedArgs {
  readonly resolver_version: string;
  readonly company_cik: number;
  readonly extractor_id: string;
  readonly role_scope: string;
  /** ISO filing date of the roster filing establishing the absences. */
  readonly filing_date: string;
  readonly accession_number: string;
  /** Keys (see {@link personRoleAssertionKey}) this filing DID assert. */
  readonly asserted: ReadonlySet<string>;
}

/** The (person, title) identity closure compares against a roster filing. */
export function personRoleAssertionKey(canonical_person_id: string, title: string): string {
  return `${canonical_person_id}\x00${normalizeRoleTitle(title)}`;
}

/**
 * The tenure match key: lowercased and clamped to the stored column width, so
 * an overlong title matches the row it created instead of minting duplicates.
 *
 * Exported so a batch pass recomputing tenures from stored observations keys
 * them exactly as the assertion path did.
 */
export function normalizeRoleTitle(title: string): string {
  return title.trim().toLowerCase().slice(0, 256);
}

/**
 * Person↔company role tenures. Both operations are idempotent and
 * out-of-order-safe: replays and late-arriving filings converge on the same
 * rows regardless of processing order (with the one documented exception that
 * a departure-and-return ingested out of order collapses into one tenure until
 * a chronological rebuild).
 *
 * Single-process only, like the junction repos: the tenure natural key cannot
 * be a storage UNIQUE constraint (multiple tenures per key are legitimate), so
 * concurrent multi-process writers — e.g. a sharded backfill splitting one
 * company's filings across processes — can duplicate tenures. Shard such runs
 * by CIK, or re-mint at a new resolver version to recover.
 */
export class PersonRoleRepo {
  private repo: PersonRoleRepositoryStorage;
  /**
   * Alias awareness is best-effort: absent an injected repo, resolve from DI;
   * a bare unit-test registry without the alias token skips alias handling.
   */
  private readonly aliasRepo: CanonicalPersonAliasRepo | undefined;

  constructor(options: PersonRoleRepoOptions = {}) {
    this.repo =
      options.personRoleRepository ?? globalServiceRegistry.get(PERSON_ROLE_REPOSITORY_TOKEN);
    try {
      this.aliasRepo = options.canonicalPersonAliasRepo ?? new CanonicalPersonAliasRepo();
    } catch {
      this.aliasRepo = undefined;
    }
  }

  /**
   * A filing at `filing_date` asserts the person holds `title` at the company.
   *
   * - Falls inside an existing tenure → refresh `last_seen_*`; if that tenure
   *   was closed by this very accession, re-open it (a re-extraction that now
   *   finds the person must undo its own earlier closure).
   * - Predates every tenure → extend the earliest tenure's `start_date` back.
   * - Postdates every closed tenure → open a new tenure.
   */
  async recordAssertion(args: PersonRoleAssertionArgs): Promise<PersonRole> {
    const normalized_title = normalizeRoleTitle(args.title);
    return tenureLocks.lock(this.tenureLockKey(args, normalized_title), () =>
      this.recordAssertionLocked(args, normalized_title)
    );
  }

  private async recordAssertionLocked(
    args: PersonRoleAssertionArgs,
    normalized_title: string
  ): Promise<PersonRole> {
    const d = args.filing_date;
    const tenures = await this.tenuresFor(args, normalized_title);

    const containing = tenures.find(
      (t) => t.start_date <= d && (t.end_date === null || d <= t.end_date)
    );
    if (containing) {
      const laterExists = tenures.some(
        (t) => t.role_id !== containing.role_id && t.start_date > containing.start_date
      );
      // Re-open when this accession retracts its own earlier closure (also
      // absorbing the "return" tenures that closure created), or — only when
      // no interposed tenure records a real gap — when the assertion is dated
      // exactly at the closure date (same-day sibling filings disagree;
      // assertion wins the tie so both processing orders converge on open).
      const selfUndo =
        containing.end_date !== null && containing.end_accession === args.accession_number;
      const tieReopen =
        containing.end_date !== null && containing.end_date === d && !selfUndo && !laterExists;
      const reopen = selfUndo || tieReopen;
      const advance = d > containing.last_seen_date;
      // A second same-day accession asserting an open tenure must be recorded
      // as its latest supporter: otherwise a later re-extraction of the first
      // accession would retract (even delete) a tenure this filing supports.
      const tieSupport =
        containing.end_date === null &&
        d === containing.last_seen_date &&
        args.accession_number !== containing.last_seen_accession;
      if (!reopen && !advance && !tieSupport) return containing;
      let updated: PersonRole = {
        ...containing,
        end_date: reopen ? null : containing.end_date,
        end_accession: reopen ? null : containing.end_accession,
        last_seen_date: advance ? d : containing.last_seen_date,
        last_seen_accession:
          advance || tieSupport ? args.accession_number : containing.last_seen_accession,
      };
      let absorbed: PersonRole[] = [];
      if (selfUndo && laterExists) {
        ({ merged: updated, absorbed } = this.mergeLaterTenures(updated, tenures));
      }
      await this.repo.put(updated);
      // Delete the absorbed rows only after the merged row is durable, so a
      // failure between the writes leaves recoverable duplicates rather than
      // lost tenure history (a replay re-absorbs them).
      for (const t of absorbed) {
        await this.repo.delete({ role_id: t.role_id });
      }
      return updated;
    }

    const laterTenures = tenures.filter((t) => t.start_date > d);
    if (laterTenures.length > 0) {
      const earliest = laterTenures.reduce((a, b) => (a.start_date <= b.start_date ? a : b));
      const updated: PersonRole = {
        ...earliest,
        start_date: d,
        start_accession: args.accession_number,
      };
      await this.repo.put(updated);
      return updated;
    }

    const inserted = await this.repo.put({
      canonical_person_id: args.canonical_person_id,
      resolver_version: args.resolver_version,
      company_cik: args.company_cik,
      extractor_id: args.extractor_id,
      role_scope: args.role_scope,
      title: args.title.trim().slice(0, 256),
      normalized_title,
      start_date: d,
      start_accession: args.accession_number,
      end_date: null,
      end_accession: null,
      last_seen_date: d,
      last_seen_accession: args.accession_number,
      created_at: new Date().toISOString(),
    } as Parameters<typeof this.repo.put>[0]);
    return inserted;
  }

  /**
   * Re-opening a tenure via self-undo can overlap tenures that started after
   * the (now undone) closure — the "return" rows that closure created. Fold
   * them into the re-opened row so one continuous (person, title) period is
   * one row again: their assertions extend `last_seen`, and a closed absorbed
   * row supplies the merged end when it postdates every assertion. The caller
   * persists the merged row before deleting the absorbed ones.
   */
  private mergeLaterTenures(
    reopened: PersonRole,
    tenures: readonly PersonRole[]
  ): { merged: PersonRole; absorbed: PersonRole[] } {
    const absorbed = tenures.filter(
      (t) => t.role_id !== reopened.role_id && t.start_date > reopened.start_date
    );
    let merged = reopened;
    let anyOpen = false;
    let maxEnd: { end_date: string; end_accession: string | null } | null = null;
    for (const t of absorbed) {
      if (t.last_seen_date > merged.last_seen_date) {
        merged = {
          ...merged,
          last_seen_date: t.last_seen_date,
          last_seen_accession: t.last_seen_accession,
        };
      }
      if (t.end_date === null) {
        anyOpen = true;
      } else if (maxEnd === null || t.end_date > maxEnd.end_date) {
        maxEnd = { end_date: t.end_date, end_accession: t.end_accession };
      }
    }
    if (!anyOpen && maxEnd !== null && maxEnd.end_date > merged.last_seen_date) {
      merged = { ...merged, end_date: maxEnd.end_date, end_accession: maxEnd.end_accession };
    }
    return { merged, absorbed };
  }

  /**
   * This filing enumerated the complete `(extractor_id, role_scope)` roster
   * for the company; close every open tenure it did not assert. Guarded by
   * `filing_date > last_seen_date` (strict), so an out-of-order older filing
   * can never close a role a newer filing asserts, and same-day filings
   * never close each other's assertions. Returns the number closed.
   */
  async closeUnasserted(args: CloseUnassertedArgs): Promise<number> {
    const candidates =
      (await this.repo.query({
        company_cik: args.company_cik,
        extractor_id: args.extractor_id,
        role_scope: args.role_scope,
        resolver_version: args.resolver_version,
      })) ?? [];

    let closed = 0;
    for (const tenure of candidates) {
      const key = personRoleAssertionKey(tenure.canonical_person_id, tenure.normalized_title);
      if (args.asserted.has(key)) continue;
      // An alias-merged person's open tenure sits under the retired canonical
      // id while post-merge filings assert under the target id — that is a
      // continuation, not a departure, so it must not be end-dated.
      if (this.aliasRepo) {
        const target = await this.aliasRepo.resolve(tenure.canonical_person_id);
        if (
          target !== tenure.canonical_person_id &&
          args.asserted.has(personRoleAssertionKey(target, tenure.normalized_title))
        ) {
          continue;
        }
      }
      // Every date guard re-reads and re-checks under the tenure lock: the
      // pre-lock row is only a candidate, and a concurrent assertion that
      // advanced `last_seen_date` in the meantime must win.
      await tenureLocks.lock(this.tenureLockKey(tenure, tenure.normalized_title), async () => {
        const live = await this.repo.get({ role_id: tenure.role_id });
        if (!live) return;
        if (live.end_date === null) {
          const laterThanAssertions = args.filing_date > live.last_seen_date;
          // A re-extraction of the filing that itself last asserted the
          // tenure, now no longer asserting it, retracts its own claim even
          // though the dates are equal.
          const selfRetraction =
            args.filing_date === live.last_seen_date &&
            live.last_seen_accession === args.accession_number;
          if (!laterThanAssertions && !selfRetraction) return;
          if (selfRetraction && live.start_accession === args.accession_number) {
            // The tenure's only support was this accession's earlier (buggy)
            // extraction — delete the phantom row instead of end-dating it.
            await this.repo.delete({ role_id: live.role_id });
            closed++;
            return;
          }
          await this.repo.put({
            ...live,
            end_date: args.filing_date,
            end_accession: args.accession_number,
          });
          closed++;
        } else if (args.filing_date < live.end_date && args.filing_date > live.last_seen_date) {
          // Already closed, but this roster is EARLIER evidence of the same
          // departure: tighten end_date back so out-of-order ingestion
          // converges on the first non-asserting filing. Not counted in the
          // return value — no open tenure changed state.
          await this.repo.put({
            ...live,
            end_date: args.filing_date,
            end_accession: args.accession_number,
          });
        }
      });
    }
    return closed;
  }

  private tenureLockKey(
    args: Pick<
      PersonRole,
      "canonical_person_id" | "resolver_version" | "company_cik" | "extractor_id" | "role_scope"
    >,
    normalized_title: string
  ): string {
    return [
      args.canonical_person_id,
      args.resolver_version,
      String(args.company_cik),
      args.extractor_id,
      args.role_scope,
      normalized_title,
    ].join("\x00");
  }

  /** All tenures for a person at a resolver version, current first. */
  async listForPerson(
    canonical_person_id: string,
    resolver_version: string
  ): Promise<PersonRole[]> {
    const rows = (await this.repo.query({ canonical_person_id, resolver_version })) ?? [];
    return rows.sort(byOpenThenRecency);
  }

  /** All tenures at a company at a resolver version, current first. */
  async listForCompany(company_cik: number, resolver_version: string): Promise<PersonRole[]> {
    const rows = (await this.repo.query({ company_cik, resolver_version })) ?? [];
    return rows.sort(byOpenThenRecency);
  }

  async count(criteria?: SearchCriteria<PersonRole>): Promise<number> {
    return await this.repo.count(criteria);
  }

  /**
   * Every tenure at a resolver version, unsorted — the rows
   * {@link deleteForResolverVersion} is about to remove, for a caller that
   * needs a copy of them first.
   */
  async listForResolverVersion(resolver_version: string): Promise<PersonRole[]> {
    return (await this.repo.query({ resolver_version })) ?? [];
  }

  /**
   * Every tenure, across resolver versions. For a pass reading tenures as
   * EVIDENCE rather than as a generation's output: what a closure recorded
   * about a filing's roster is a property of that filing, so a retired
   * generation's rows say it just as well as the live one's.
   */
  async listAll(): Promise<PersonRole[]> {
    return (await this.repo.getAll()) ?? [];
  }

  /**
   * Write one already-computed tenure outright, with no read-modify-write of
   * whatever the natural key currently holds — for a pass that derives the
   * whole tenure (its bounds, its supporting accessions) from the current
   * observations and replaces a resolver version's rows wholesale rather than
   * reconciling them one assertion at a time. `role_id` is the storage's to
   * assign and `created_at` is stamped here, so neither is a caller's to
   * carry over.
   *
   * Serialised per tenure natural key like {@link recordAssertion}, so one
   * write cannot land inside another caller's read-modify-write of the same
   * key. That is the whole of the guarantee: the lock spans a single row, not
   * a caller's purge-then-write sequence, so a rebuild expects ingestion to be
   * quiesced.
   */
  async insertTenure(tenure: Omit<PersonRole, "role_id" | "created_at">): Promise<PersonRole> {
    return tenureLocks.lock(
      this.tenureLockKey(tenure, tenure.normalized_title),
      async () =>
        await this.repo.put({
          ...tenure,
          created_at: new Date().toISOString(),
        } as Parameters<typeof this.repo.put>[0])
    );
  }

  async deleteForResolverVersion(resolver_version: string): Promise<number> {
    const n = await this.repo.count({ resolver_version });
    await this.repo.deleteSearch({ resolver_version });
    return n;
  }

  /**
   * Delete tenures whose only recorded support is `accession_number` — the
   * reap counterpart of closure's self-retraction, for scopes with no roster
   * pass. A tenure both opened and last asserted by the reaped filing has no
   * other filing standing behind it.
   */
  async deleteSoleSupport(args: {
    readonly canonical_person_id: string;
    readonly resolver_version: string;
    readonly extractor_id: string;
    readonly accession_number: string;
  }): Promise<number> {
    const rows =
      (await this.repo.query({
        canonical_person_id: args.canonical_person_id,
        resolver_version: args.resolver_version,
        extractor_id: args.extractor_id,
      })) ?? [];
    let deleted = 0;
    for (const tenure of rows) {
      if (
        tenure.start_accession !== args.accession_number ||
        tenure.last_seen_accession !== args.accession_number
      ) {
        continue;
      }
      await tenureLocks.lock(this.tenureLockKey(tenure, tenure.normalized_title), async () => {
        const live = await this.repo.get({ role_id: tenure.role_id });
        if (!live) return;
        if (
          live.start_accession !== args.accession_number ||
          live.last_seen_accession !== args.accession_number
        ) {
          return;
        }
        await this.repo.delete({ role_id: live.role_id });
        deleted++;
      });
    }
    return deleted;
  }

  private async tenuresFor(
    args: Pick<
      PersonRoleAssertionArgs,
      "canonical_person_id" | "resolver_version" | "company_cik" | "extractor_id" | "role_scope"
    >,
    normalized_title: string
  ): Promise<PersonRole[]> {
    return (
      (await this.repo.query({
        canonical_person_id: args.canonical_person_id,
        resolver_version: args.resolver_version,
        company_cik: args.company_cik,
        extractor_id: args.extractor_id,
        role_scope: args.role_scope,
        normalized_title,
      })) ?? []
    );
  }
}

/** Open tenures first, then by most recent start. */
function byOpenThenRecency(a: PersonRole, b: PersonRole): number {
  if ((a.end_date === null) !== (b.end_date === null)) return a.end_date === null ? -1 : 1;
  return a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0;
}
