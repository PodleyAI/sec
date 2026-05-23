/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  COMPANY_OBSERVATION_REPOSITORY_TOKEN,
  type CompanyObservation,
  type CompanyObservationRepositoryStorage,
} from "./CompanyObservationSchema";

/**
 * Draft type for `upsertByNaturalKey` callers: `observation_id` is omitted
 * (repo-assigned). All nullable observation fields can also be omitted; they
 * default to `null` in the persisted row.
 */
export type CompanyObservationDraft = Omit<
  CompanyObservation,
  | "observation_id"
  | "cik"
  | "crd_number"
  | "name"
  | "normalized_name"
  | "jurisdiction"
  | "entity_type"
  | "raw_address_id"
  | "raw_phone_id"
  | "source_context"
> &
  Partial<
    Pick<
      CompanyObservation,
      | "cik"
      | "crd_number"
      | "name"
      | "normalized_name"
      | "jurisdiction"
      | "entity_type"
      | "raw_address_id"
      | "raw_phone_id"
      | "source_context"
    >
  >;

interface CompanyObservationRepoOptions {
  companyObservationRepository?: CompanyObservationRepositoryStorage;
}

/**
 * Manages CompanyObservation rows. Natural-key upsert is idempotent on
 * `(accession_number, extractor_id, observation_index)`; the synthetic
 * `observation_id` is assigned by `storage.size() + 1` on insert and
 * preserved on collision. `extractor_version` is recorded but not part of
 * the natural key — re-extraction at a new version overwrites in place.
 */
export class CompanyObservationRepo {
  private repo: CompanyObservationRepositoryStorage;

  constructor(options: CompanyObservationRepoOptions = {}) {
    this.repo =
      options.companyObservationRepository ??
      globalServiceRegistry.get(COMPANY_OBSERVATION_REPOSITORY_TOKEN);
  }

  async upsertByNaturalKey(draft: CompanyObservationDraft): Promise<CompanyObservation> {
    const matches = await this.repo.query({
      accession_number: draft.accession_number,
      extractor_id: draft.extractor_id,
      observation_index: draft.observation_index,
    });
    const existing = matches?.[0];
    if (existing) {
      const merged: CompanyObservation = {
        ...existing,
        ...this.applyNullDefaults(draft),
        observation_id: existing.observation_id,
      };
      await this.repo.put(merged);
      return merged;
    }
    const next_id = (await this.repo.size()) + 1;
    const row: CompanyObservation = {
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
  ): Promise<CompanyObservation | undefined> {
    const matches = await this.repo.query({
      accession_number,
      extractor_id,
      observation_index,
    });
    return matches?.[0];
  }

  async getById(observation_id: number): Promise<CompanyObservation | undefined> {
    return await this.repo.get({ observation_id });
  }

  async listByAccession(accession_number: string): Promise<CompanyObservation[]> {
    const rows = (await this.repo.query({ accession_number })) ?? [];
    return rows.sort((a, b) => a.observation_index - b.observation_index);
  }

  async listAll(): Promise<CompanyObservation[]> {
    return (await this.repo.getAll()) ?? [];
  }

  private applyNullDefaults(
    draft: CompanyObservationDraft
  ): Omit<CompanyObservation, "observation_id"> {
    return {
      accession_number: draft.accession_number,
      extractor_id: draft.extractor_id,
      extractor_version: draft.extractor_version,
      observation_index: draft.observation_index,
      cik: draft.cik ?? null,
      crd_number: draft.crd_number ?? null,
      name: draft.name ?? null,
      normalized_name: draft.normalized_name ?? null,
      jurisdiction: draft.jurisdiction ?? null,
      entity_type: draft.entity_type ?? null,
      raw_address_id: draft.raw_address_id ?? null,
      raw_phone_id: draft.raw_phone_id ?? null,
      source_context: draft.source_context ?? null,
      created_at: draft.created_at,
    };
  }
}
