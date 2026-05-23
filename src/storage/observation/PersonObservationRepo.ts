/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
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
  | "title"
  | "relationship"
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
      | "title"
      | "relationship"
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
 * `observation_id` is assigned by `storage.size() + 1` on insert and
 * preserved on collision. `extractor_version` is recorded but does not
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
    const matches = await this.repo.query({
      accession_number: draft.accession_number,
      extractor_id: draft.extractor_id,
      observation_index: draft.observation_index,
    });
    const existing = matches?.[0];
    if (existing) {
      const merged: PersonObservation = {
        ...existing,
        ...this.applyNullDefaults(draft),
        observation_id: existing.observation_id,
      };
      await this.repo.put(merged);
      return merged;
    }
    const next_id = (await this.repo.size()) + 1;
    const row: PersonObservation = {
      observation_id: next_id,
      ...this.applyNullDefaults(draft),
    };
    await this.repo.put(row);
    return row;
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

  async listAll(): Promise<PersonObservation[]> {
    return (await this.repo.getAll()) ?? [];
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
      title: draft.title ?? null,
      relationship: draft.relationship ?? null,
      raw_address_id: draft.raw_address_id ?? null,
      raw_phone_id: draft.raw_phone_id ?? null,
      source_context: draft.source_context ?? null,
      created_at: draft.created_at,
    };
  }
}
