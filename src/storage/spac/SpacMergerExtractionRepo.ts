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

  /**
   * Record the deterministic approval verdict on an existing row, leaving the
   * extraction it holds untouched. The verdict is a property of the DOCUMENT,
   * not of the model call, so a run whose extraction never produced rows still
   * has one to report — and the backfill keys on a NULL verdict, so leaving it
   * unset re-selects the filing on every sweep. Returns false when no row
   * exists: there is nothing to annotate, and a row asserting an extraction
   * that never happened would be read as one by every predicate downstream.
   */
  async recordApprovalVerdict(
    accession_number: string,
    seeks_combination_approval: boolean
  ): Promise<boolean> {
    const row = await this.getByAccession(accession_number);
    if (!row) return false;
    if (row.seeks_combination_approval !== seeks_combination_approval) {
      await this.storage.put({ ...row, seeks_combination_approval });
    }
    return true;
  }

  /** All extractions for a CIK (unordered). */
  async getByCik(cik: number): Promise<SpacMergerExtraction[]> {
    return (await this.storage.query({ cik })) || [];
  }
}
