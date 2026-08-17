/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ExtractorRun,
  ExtractorRunOutcome,
  ExtractorRunRepositoryStorage,
} from "./ExtractorRunSchema";
import { semverMajorMinorPrefix } from "./semver";

/**
 * Pre-`outcome` rows (success / failure boolean only) are inferred to
 * outcome=success when success=true, outcome=failure otherwise. Partial is
 * unknowable for legacy rows — the boolean alone can't distinguish a
 * fully-successful run from one whose sections silently dead-lettered.
 */
function inferOutcome(row: ExtractorRun): ExtractorRunOutcome {
  if (row.outcome) return row.outcome;
  return row.success ? "success" : "failure";
}

export interface FilingKey {
  readonly cik: number;
  readonly accession_number: string;
}

/**
 * Helper around the extractor_runs table. Call sites use:
 *   - recordRun: every ProcessAccessionDocFormTask attempt writes one row.
 *   - hasSuccessfulRun: single-filing check.
 *   - listFilingsWithoutSuccessfulRun: ComputeFormsWorklistTask scheduling.
 *
 * Re-running the same (cik, accession, extractor_id, extractor_version)
 * overwrites the prior row by PK — preserving a per-execution history
 * is intentionally not a goal (one row per version per filing).
 */
export class ExtractorRunRepo {
  constructor(private readonly storage: ExtractorRunRepositoryStorage) {}

  async recordRun(
    row: Omit<ExtractorRun, "ran_at" | "outcome"> & {
      outcome?: ExtractorRunOutcome;
    }
  ): Promise<void> {
    const outcome: ExtractorRunOutcome = row.outcome ?? (row.success ? "success" : "failure");
    await this.storage.put({
      ...row,
      // success stays as the back-compat boolean mirror of outcome === "success".
      success: outcome === "success",
      outcome,
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

  /**
   * Most recent run for a filing+extractor, across ALL extractor_version
   * values (unlike `findRun`, which is exact-version). Used to detect
   * whether a re-run is happening at the SAME extractor version as its
   * predecessor — a same-version re-run must not reap observations that
   * merely didn't reappear due to LLM sampling variance (see
   * ProcessAccessionDocFormTask's reap gate).
   */
  async findLatestRun(
    cik: number,
    accession_number: string,
    extractor_id: string
  ): Promise<ExtractorRun | undefined> {
    const rows = await this.storage.query({ cik, accession_number, extractor_id });
    if (!rows || rows.length === 0) return undefined;
    return rows.reduce((latest, r) => (r.ran_at > latest.ran_at ? r : latest));
  }

  async hasSuccessfulRun(
    cik: number,
    accession_number: string,
    extractor_id: string,
    extractor_version: string
  ): Promise<boolean> {
    const row = await this.findRun(cik, accession_number, extractor_id, extractor_version);
    return row !== undefined && inferOutcome(row) === "success";
  }

  /**
   * Counts successful runs for a specific (extractor_id, extractor_version).
   * Used by the major-promote coverage gate. Exact-match (not major.minor
   * prefix) because the gate measures actual production at the new version.
   * Partial runs do NOT count — coverage measures fully-successful production.
   */
  async countSuccessfulAtVersion(extractor_id: string, extractor_version: string): Promise<number> {
    const rows =
      (await this.storage.query({
        extractor_id,
        extractor_version,
        success: true,
      })) ?? [];
    // success=true narrows the storage scan; inferOutcome is the source of truth
    // (legacy rows lack outcome and fall back to success).
    return rows.filter((r) => inferOutcome(r) === "success").length;
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
   * filings), the result set can reach ~100-200 MB. This is
   * acceptable while the data set is small in absolute terms; a future
   * migration should switch to a streaming or anti-join (WHERE NOT EXISTS) query
   * once the data set grows.
   *
   * ComputeFormsWorklistTask always passes `form`. The no-form path is retained
   * for coverage queries that may need to count across an extractor's variants.
   */
  async deleteForExtractorVersion(
    extractor_id: string,
    extractor_version: string
  ): Promise<number> {
    const rows = (await this.storage.query({ extractor_id, extractor_version })) ?? [];
    for (const r of rows) {
      await this.storage.delete({
        cik: r.cik,
        accession_number: r.accession_number,
        extractor_id: r.extractor_id,
        extractor_version: r.extractor_version,
      });
    }
    return rows.length;
  }

  async listFilingsWithoutSuccessfulRun<T extends FilingKey>(
    filings: ReadonlyArray<T>,
    extractor_id: string,
    extractor_version: string,
    form?: string
  ): Promise<T[]> {
    const successfulKeys = await this.successfulRunKeys(extractor_id, extractor_version, form);
    return filings.filter((f) => !successfulKeys.has(filingRunKey(f)));
  }

  /**
   * The `cik::accession_number` keys of every filing already processed
   * successfully at (extractor_id, major.minor of extractor_version[, form]).
   *
   * Split out of {@link listFilingsWithoutSuccessfulRun} so a caller streaming
   * a large candidate set can build this set ONCE and test each page against
   * it, rather than re-running the query per page. Test membership with
   * {@link filingRunKey} so both sides agree on the key format.
   *
   * Sized by the extractor's successful-run count, not by the candidate
   * filings — bounded by the extractor_runs table, so it stays modest even
   * when the candidate set runs to millions of filings.
   */
  async successfulRunKeys(
    extractor_id: string,
    extractor_version: string,
    form?: string
  ): Promise<Set<string>> {
    // Patch-ceremony reading-side gating: match on major.minor
    // prefix so a row at "1.0.0" satisfies the gate for any "1.0.x" current.
    // A row at "1.1.0" or "2.0.0" does NOT satisfy a "1.0.x" gate.
    const prefix = semverMajorMinorPrefix(extractor_version);

    // Workglow's tabular query doesn't expose LIKE/prefix matching today, so
    // we narrow with the available criteria (extractor_id, success, optionally
    // form) and post-filter on extractor_version in memory. Note: with patch
    // patch ceremony, the criteria no longer constrains extractor_version,
    // so the worst-case successful-set spans ALL versions for this extractor
    // (1.0.0, 1.0.1, 1.1.0, 2.0.0, ...). For a long-lived extractor with many
    // versions and many filings, this set can grow substantially. See the
    // scale-note JSDoc above; a streaming/anti-join migration is the
    // documented long-term fix.
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

    return new Set(
      (successful ?? [])
        .filter((r) => r.extractor_version.startsWith(prefix))
        // Partial rows have success=true but outcome="partial"; they are NOT
        // "successful enough" — retry-dead-letters should still pick them up.
        .filter((r) => inferOutcome(r) === "success")
        .map((r) => filingRunKey(r))
    );
  }
}

/** Key format shared by {@link ExtractorRunRepo.successfulRunKeys} and its callers. */
export function filingRunKey(f: FilingKey): string {
  return `${f.cik}::${f.accession_number}`;
}
