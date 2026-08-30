/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import { KeyedMutex } from "../../util/KeyedMutex";
import {
  PERSON_ROLE_REPOSITORY_TOKEN,
  type PersonRole,
  type PersonRoleRepositoryStorage,
} from "./PersonRoleSchema";

interface PersonRoleRepoOptions {
  personRoleRepository?: PersonRoleRepositoryStorage;
}

/**
 * Serialises read-modify-write per tenure natural key. Single-process only —
 * same caveat as the junction repos' lock.
 */
const tenureLocks = new KeyedMutex<string>();

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
  constructor(options: PersonRoleRepoOptions = {}) {
    this.repo =
      options.personRoleRepository ?? globalServiceRegistry.get(PERSON_ROLE_REPOSITORY_TOKEN);
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
}

/** Open tenures first, then by most recent start. */
function byOpenThenRecency(a: PersonRole, b: PersonRole): number {
  if ((a.end_date === null) !== (b.end_date === null)) return a.end_date === null ? -1 : 1;
  return a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : 0;
}
