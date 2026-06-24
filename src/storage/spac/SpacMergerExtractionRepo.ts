/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SpacMergerExtraction,
  SPAC_MERGER_EXTRACTION_REPOSITORY_TOKEN,
  SpacMergerExtractionRepositoryStorage,
} from "./SpacMergerExtractionSchema";

/** Per-accession merger-proxy extraction rows. */
export class SpacMergerExtractionRepo {
  private readonly storage: SpacMergerExtractionRepositoryStorage;

  constructor(storage?: SpacMergerExtractionRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(SPAC_MERGER_EXTRACTION_REPOSITORY_TOKEN);
  }

  async save(row: SpacMergerExtraction): Promise<void> {
    await this.storage.put(row);
  }

  async getByAccession(accession_number: string): Promise<SpacMergerExtraction | undefined> {
    return this.storage.get({ accession_number });
  }

  /** All extractions for a CIK (unordered). */
  async getByCik(cik: number): Promise<SpacMergerExtraction[]> {
    return (await this.storage.query({ cik })) || [];
  }
}
