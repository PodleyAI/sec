/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SpacLoiExtraction,
  SPAC_LOI_EXTRACTION_REPOSITORY_TOKEN,
  SpacLoiExtractionRepositoryStorage,
} from "./SpacLoiExtractionSchema";

/** Per-accession LOI-extraction rows. */
export class SpacLoiExtractionRepo {
  private readonly storage: SpacLoiExtractionRepositoryStorage;

  constructor(storage?: SpacLoiExtractionRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(SPAC_LOI_EXTRACTION_REPOSITORY_TOKEN);
  }

  async save(row: SpacLoiExtraction): Promise<void> {
    await this.storage.put(row);
  }

  async getByAccession(accession_number: string): Promise<SpacLoiExtraction | undefined> {
    return this.storage.get({ accession_number });
  }

  /** All extractions for a CIK (unordered). */
  async getByCik(cik: number): Promise<SpacLoiExtraction[]> {
    return (await this.storage.query({ cik })) || [];
  }
}
