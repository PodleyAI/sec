/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SpacRedemptionExtraction,
  SPAC_REDEMPTION_EXTRACTION_REPOSITORY_TOKEN,
  SpacRedemptionExtractionRepositoryStorage,
} from "./SpacRedemptionExtractionSchema";

/** Per-accession redemption-extraction rows. */
export class SpacRedemptionExtractionRepo {
  private readonly storage: SpacRedemptionExtractionRepositoryStorage;

  constructor(storage?: SpacRedemptionExtractionRepositoryStorage) {
    this.storage =
      storage ?? globalServiceRegistry.get(SPAC_REDEMPTION_EXTRACTION_REPOSITORY_TOKEN);
  }

  async save(row: SpacRedemptionExtraction): Promise<void> {
    await this.storage.put(row);
  }

  async getByAccession(accession_number: string): Promise<SpacRedemptionExtraction | undefined> {
    return this.storage.get({ accession_number });
  }

  /** All extractions for a CIK (unordered). */
  async getByCik(cik: number): Promise<SpacRedemptionExtraction[]> {
    return (await this.storage.query({ cik })) || [];
  }
}
