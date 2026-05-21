/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ExtractorRun,
  ExtractorRunRepositoryStorage,
} from "./ExtractorRunSchema";

export interface FilingKey {
  readonly cik: string;
  readonly accession_number: string;
}

/**
 * Helper around the extractor_runs table. PR2 call sites use:
 *   - recordRun: every ProcessAccessionDocFormTask attempt writes one row.
 *   - hasSuccessfulRun: single-filing check.
 *   - listFilingsWithoutSuccessfulRun: UpdateAllFormsTask scheduling.
 *
 * Re-running the same (cik, accession, extractor_id, extractor_version)
 * overwrites the prior row by PK — preserving a per-execution history
 * is intentionally not a goal (see spec D3: one row per version per filing).
 */
export class ExtractorRunRepo {
  constructor(private readonly storage: ExtractorRunRepositoryStorage) {}

  async recordRun(
    row: Omit<ExtractorRun, "ran_at"> & { ran_at?: string }
  ): Promise<void> {
    await this.storage.put({
      ...row,
      ran_at: row.ran_at ?? new Date().toISOString(),
    });
  }

  async findRun(
    cik: string,
    accession_number: string,
    extractor_id: string,
    extractor_version: string
  ): Promise<ExtractorRun | undefined> {
    const rows = await this.storage.query({
      cik,
      accession_number,
      extractor_id,
      extractor_version,
    });
    return rows?.[0];
  }

  async hasSuccessfulRun(
    cik: string,
    accession_number: string,
    extractor_id: string,
    extractor_version: string
  ): Promise<boolean> {
    const row = await this.findRun(
      cik,
      accession_number,
      extractor_id,
      extractor_version
    );
    return row?.success === true;
  }

  /**
   * Given a list of candidate filings, returns those WITHOUT a successful
   * run for the given (extractor_id, extractor_version). A failed run
   * still counts as "unprocessed" — it should be retried.
   */
  async listFilingsWithoutSuccessfulRun<T extends FilingKey>(
    filings: ReadonlyArray<T>,
    extractor_id: string,
    extractor_version: string
  ): Promise<T[]> {
    const successful = await this.storage.query({
      extractor_id,
      extractor_version,
      success: true,
    });
    const successfulKeys = new Set(
      (successful ?? []).map((r) => `${r.cik}::${r.accession_number}`)
    );
    return filings.filter(
      (f) => !successfulKeys.has(`${f.cik}::${f.accession_number}`)
    );
  }
}
