/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  EXECUTIVE_COMPENSATION_REPOSITORY_TOKEN,
  type ExecutiveCompensation,
  type ExecutiveCompensationRepositoryStorage,
} from "./ExecutiveCompensationSchema";

export class ExecutiveCompensationRepo {
  private readonly storage: ExecutiveCompensationRepositoryStorage;

  constructor(storage?: ExecutiveCompensationRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(EXECUTIVE_COMPENSATION_REPOSITORY_TOKEN);
  }

  async save(row: ExecutiveCompensation): Promise<void> {
    await this.storage.put(row);
  }

  async queryByAccession(accession_number: string): Promise<ExecutiveCompensation[]> {
    return (await this.storage.query({ accession_number })) ?? [];
  }

  /**
   * Removes every compensation row for a filing. Rows are keyed by a positional
   * `(accession_number, extractor_id, row_index)`, so re-extracting a filing
   * that now yields fewer rows would otherwise leave stale orphans at the higher
   * indices. Callers clear before re-inserting to stay idempotent.
   */
  async clear(accession_number: string): Promise<void> {
    const rows = (await this.storage.query({ accession_number })) ?? [];
    for (const row of rows) {
      await this.storage.delete({
        accession_number,
        extractor_id: row.extractor_id,
        row_index: row.row_index,
      });
    }
  }
}
