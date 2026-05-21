/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ExtractorRun,
  ExtractorRunRepositoryStorage,
} from "./ExtractorRunSchema";
import { semverMajorMinorPrefix } from "./semver";

export interface FilingKey {
  readonly cik: number;
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
    row: Omit<ExtractorRun, "ran_at">
  ): Promise<void> {
    await this.storage.put({
      ...row,
      ran_at: new Date().toISOString(),
    } as ExtractorRun);
  }

  async findRun(
    cik: number,
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
    cik: number,
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
   *
   * When `form` is provided, the successful-runs query is narrowed to that
   * exact form symbol. Recommended when the caller is iterating one form
   * variant at a time — keeps the in-memory result set bounded.
   *
   * Scale note: this method materializes the full set of successful runs
   * for the requested (extractor_id, extractor_version[, form]) tuple into
   * an in-memory Set. At Form D's projected size (hundreds of thousands of
   * filings), the result set can reach ~100-200 MB. For PR2 this is
   * acceptable because the data set is small in absolute terms; a future
   * plan should switch to a streaming or anti-join (WHERE NOT EXISTS) query
   * once the data set grows.
   *
   * In PR2, the only production caller (UpdateAllFormsTask) always passes
   * `form`. The no-form path is retained for PR3's coverage queries which
   * may need to count across an extractor's variants.
   */
  async listFilingsWithoutSuccessfulRun<T extends FilingKey>(
    filings: ReadonlyArray<T>,
    extractor_id: string,
    extractor_version: string,
    form?: string
  ): Promise<T[]> {
    // Patch-ceremony reading-side gating (PR3 spec D7): match on major.minor
    // prefix so a row at "1.0.0" satisfies the gate for any "1.0.x" current.
    // A row at "1.1.0" or "2.0.0" does NOT satisfy a "1.0.x" gate.
    const prefix = semverMajorMinorPrefix(extractor_version);

    // Workglow's tabular query doesn't expose LIKE/prefix matching today, so
    // we narrow with the available criteria (extractor_id, success, optionally
    // form) and post-filter on extractor_version in memory. Cost is the same
    // O(N-successful-rows) as before — see the scale-note JSDoc above.
    const successful =
      form === undefined
        ? await this.storage.query({
            extractor_id,
            success: true,
          })
        : await this.storage.query({
            extractor_id,
            success: true,
            form,
          });

    const successfulKeys = new Set(
      (successful ?? [])
        .filter((r) => r.extractor_version.startsWith(prefix))
        .map((r) => `${r.cik}::${r.accession_number}`)
    );
    return filings.filter(
      (f) => !successfulKeys.has(`${f.cik}::${f.accession_number}`)
    );
  }
}
