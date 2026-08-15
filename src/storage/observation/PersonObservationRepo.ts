/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import type { SearchCriteria } from "workglow";
import { isUniqueConstraintError } from "../../util/isUniqueConstraintError";
import {
  PERSON_OBSERVATION_REPOSITORY_TOKEN,
  type PersonObservation,
  type PersonObservationRepositoryStorage,
} from "./PersonObservationSchema";

/**
 * Draft type for `upsertByNaturalKey` callers: `observation_id` is omitted
 * because the repo assigns it. All nullable observation fields can also be
 * omitted; they default to `null` in the persisted row.
 */
export type PersonObservationDraft = Omit<
  PersonObservation,
  | "observation_id"
  | "source_filing_issuer_cik"
  | "cik"
  | "first_name"
  | "middle_name"
  | "last_name"
  | "suffix"
  | "normalized_first"
  | "normalized_middle"
  | "normalized_last"
  | "normalized_suffix"
  | "relationship"
  | "birth_year"
  | "bio"
  | "raw_address_id"
  | "raw_phone_id"
  | "source_context"
> &
  Partial<
    Pick<
      PersonObservation,
      | "source_filing_issuer_cik"
      | "cik"
      | "first_name"
      | "middle_name"
      | "last_name"
      | "suffix"
      | "normalized_first"
      | "normalized_middle"
      | "normalized_last"
      | "normalized_suffix"
      | "relationship"
      | "birth_year"
      | "bio"
      | "raw_address_id"
      | "raw_phone_id"
      | "source_context"
    >
  >;

interface PersonObservationRepoOptions {
  personObservationRepository?: PersonObservationRepositoryStorage;
}

/**
 * Manages PersonObservation rows. Natural-key upsert is idempotent on
 * `(accession_number, extractor_id, observation_index)`; the synthetic
 * `observation_id` is assigned by the underlying storage backend (via the
 * `x-auto-generated: true` schema annotation — INTEGER PRIMARY KEY
 * AUTOINCREMENT on SQLite, SERIAL on Postgres, in-memory counter for tests)
 * and preserved on collision. `extractor_version` is recorded but does not
 * affect the natural key — re-extraction at a new version overwrites the
 * same row.
 */
export class PersonObservationRepo {
  private repo: PersonObservationRepositoryStorage;

  constructor(options: PersonObservationRepoOptions = {}) {
    this.repo =
      options.personObservationRepository ??
      globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN);
  }

  async upsertByNaturalKey(draft: PersonObservationDraft): Promise<PersonObservation> {
    const existing = await this.getByNaturalKey(
      draft.accession_number,
      draft.extractor_id,
      draft.observation_index
    );
    if (existing) return this.mergeOnto(existing, draft);

    // No prior row for this natural key: hand the storage backend a draft
    // without `observation_id` and let the auto-generated PK assign one.
    // `put()` returns the persisted row including the assigned key.
    try {
      return await this.repo.put(
        this.applyNullDefaults(draft) as Parameters<typeof this.repo.put>[0]
      );
    } catch (err) {
      // A concurrent caller inserted the same natural key between our query and
      // this put. The (accession_number, extractor_id, observation_index)
      // UNIQUE index rejects the duplicate; re-read the winner and merge onto
      // it so both callers converge on one row instead of forking two.
      if (!isUniqueConstraintError(err)) throw err;
      const winner = await this.getByNaturalKey(
        draft.accession_number,
        draft.extractor_id,
        draft.observation_index
      );
      if (!winner) throw err;
      return this.mergeOnto(winner, draft);
    }
  }

  private async mergeOnto(
    existing: PersonObservation,
    draft: PersonObservationDraft
  ): Promise<PersonObservation> {
    const merged: PersonObservation = {
      ...existing,
      ...this.applyNullDefaults(draft),
      observation_id: existing.observation_id,
    };
    await this.repo.put(merged);
    return merged;
  }

  async getByNaturalKey(
    accession_number: string,
    extractor_id: string,
    observation_index: number
  ): Promise<PersonObservation | undefined> {
    const matches = await this.repo.query({
      accession_number,
      extractor_id,
      observation_index,
    });
    return matches?.[0];
  }

  async getById(observation_id: number): Promise<PersonObservation | undefined> {
    return await this.repo.get({ observation_id });
  }

  async listByAccession(accession_number: string): Promise<PersonObservation[]> {
    const rows = (await this.repo.query({ accession_number })) ?? [];
    return rows.sort((a, b) => a.observation_index - b.observation_index);
  }

  /** All observations for one filing + extractor (the reaping scope). */
  async listByAccessionAndExtractor(
    accession_number: string,
    extractor_id: string
  ): Promise<PersonObservation[]> {
    return (await this.repo.query({ accession_number, extractor_id })) ?? [];
  }

  async deleteByObservationId(observation_id: number): Promise<void> {
    await this.repo.delete({ observation_id });
  }

  async listAll(): Promise<PersonObservation[]> {
    return (await this.repo.getAll()) ?? [];
  }

  /**
   * Rewrites only the derived identity columns of an existing row, leaving the
   * name as filed untouched. Used by the batch re-normalizer so a change to
   * `normalizePerson` can take effect without re-extracting the filing that
   * produced the row.
   */
  async updateNormalizedParts(
    row: PersonObservation,
    parts: Pick<
      PersonObservation,
      "normalized_first" | "normalized_middle" | "normalized_last" | "normalized_suffix"
    >
  ): Promise<void> {
    await this.repo.put({ ...row, ...parts });
  }

  /**
   * Pass-through to the underlying tabular storage's COUNT path. Callers
   * (e.g. `ResolverCoverage`) must prefer this over `(await listAll()).length`
   * at Form D / Section 16 scale to avoid materializing the full table.
   */
  async count(criteria?: SearchCriteria<PersonObservation>): Promise<number> {
    return await this.repo.count(criteria);
  }

  private applyNullDefaults(
    draft: PersonObservationDraft
  ): Omit<PersonObservation, "observation_id"> {
    return {
      accession_number: draft.accession_number,
      extractor_id: draft.extractor_id,
      extractor_version: draft.extractor_version,
      observation_index: draft.observation_index,
      source_filing_issuer_cik: draft.source_filing_issuer_cik ?? null,
      cik: draft.cik ?? null,
      first_name: draft.first_name ?? null,
      middle_name: draft.middle_name ?? null,
      last_name: draft.last_name ?? null,
      suffix: draft.suffix ?? null,
      normalized_first: draft.normalized_first ?? null,
      normalized_middle: draft.normalized_middle ?? null,
      normalized_last: draft.normalized_last ?? null,
      normalized_suffix: draft.normalized_suffix ?? null,
      relationship: draft.relationship ?? null,
      birth_year: draft.birth_year ?? null,
      bio: draft.bio ?? null,
      raw_address_id: draft.raw_address_id ?? null,
      raw_phone_id: draft.raw_phone_id ?? null,
      source_context: draft.source_context ?? null,
      created_at: draft.created_at,
    };
  }
}
