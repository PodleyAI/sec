/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN,
  type BeneficialOwnership,
  type BeneficialOwnershipRepositoryStorage,
} from "./BeneficialOwnershipSchema";

export class BeneficialOwnershipRepo {
  private readonly storage: BeneficialOwnershipRepositoryStorage;

  constructor(storage?: BeneficialOwnershipRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN);
  }

  async save(row: BeneficialOwnership): Promise<void> {
    await this.storage.put(row);
  }

  async queryByAccession(accession_number: string): Promise<BeneficialOwnership[]> {
    return (await this.storage.query({ accession_number })) ?? [];
  }

  async listAll(): Promise<BeneficialOwnership[]> {
    return (await this.storage.getAll()) ?? [];
  }

  /**
   * Removes every beneficial-ownership row for a filing. Rows are keyed by a
   * positional `(accession_number, extractor_id, observation_index)`, so
   * re-extracting a filing that now yields fewer rows would otherwise leave
   * stale orphans at the higher indices. Callers clear before re-inserting to
   * stay idempotent.
   */
  async clear(accession_number: string): Promise<void> {
    const rows = (await this.storage.query({ accession_number })) ?? [];
    for (const row of rows) {
      await this.storage.delete({
        accession_number,
        extractor_id: row.extractor_id,
        observation_index: row.observation_index,
      });
    }
  }
}
