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

/**
 * CIKs per `in` list in {@link ExtractorRunRepo.successfulRunKeysForFilings}.
 * SQLite binds one parameter per value and stays subject to
 * `SQLITE_MAX_VARIABLE_NUMBER` (999 on older builds); Postgres binds the list as
 * one array. 900 matches the other `in`-list callers (observation titles, the
 * forms worklist, SPAC download); the other binds in these queries are
 * `extractor_id`, `success` and optionally `form`.
 */
const RUN_CIK_CHUNK = 900;

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
    row: Omit<ExtractorRun, "ran_at" | "outcome" | "read_full_submission"> & {
      outcome?: ExtractorRunOutcome;
      read_full_submission?: boolean | null;
    }
  ): Promise<void> {
    const outcome: ExtractorRunOutcome = row.outcome ?? (row.success ? "success" : "failure");
    await this.storage.put({
      ...row,
      // success stays as the back-compat boolean mirror of outcome === "success".
      success: outcome === "success",
      outcome,
      // Omitting it stores null — "nobody recorded what this run was handed" —
      // rather than false, which would claim the extractor read the primary
      // document alone. Only a caller that knows may say so.
      read_full_submission: row.read_full_submission ?? null,
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
   * Deletes one issuer's runs for the named extractors only, and only at the
   * version generation each is active at (major.minor prefix, the same rule
   * {@link successfulRunKeysForFilings} reads by). Rows for any other extractor
   * id, and rows from an older or newer generation, survive.
   *
   * The scope is the point. `extractor_runs` is the production ledger the
   * major-promote coverage gate counts, and nothing can rebuild it: an
   * unscoped per-issuer wipe took that CIK's Form D, ownership and
   * prior-version history with it. A full `spac process --force` needs only
   * the generation it is about to replay cleared, so that a filing which
   * throws before recording cannot leave a stale success row behind for the
   * outcome counter to report as processed.
   */
  async deleteForCikExtractors(
    cik: number,
    activeVersionByExtractorId: ReadonlyMap<string, string>
  ): Promise<void> {
    if (activeVersionByExtractorId.size === 0) return;
    const rows = (await this.storage.query({ cik })) ?? [];
    for (const r of rows) {
      const active = activeVersionByExtractorId.get(r.extractor_id);
      if (active === undefined) continue;
      if (!r.extractor_version.startsWith(semverMajorMinorPrefix(active))) continue;
      await this.storage.delete({
        cik: r.cik,
        accession_number: r.accession_number,
        extractor_id: r.extractor_id,
        extractor_version: r.extractor_version,
      });
    }
  }

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

  /**
   * Given a list of candidate filings, returns those WITHOUT a successful
   * run for the given (extractor_id, extractor_version). A failed run
   * still counts as "unprocessed" — it should be retried.
   *
   * When `form` is provided, the successful-runs query is narrowed to that
   * exact form symbol. Recommended when the caller is iterating one form
   * variant at a time — it narrows the rows each chunk reads.
   */
  async listFilingsWithoutSuccessfulRun<T extends FilingKey>(
    filings: ReadonlyArray<T>,
    extractor_id: string,
    extractor_version: string,
    form?: string
  ): Promise<T[]> {
    const successfulKeys = await this.successfulRunKeysForFilings(
      filings,
      extractor_id,
      extractor_version,
      form
    );
    return filings.filter((f) => !successfulKeys.has(filingRunKey(f)));
  }

  /**
   * The `cik::accession_number` keys of the CANDIDATE filings that have already
   * been processed successfully at (extractor_id, major.minor of
   * extractor_version[, form]). Test membership with {@link filingRunKey} so
   * both sides agree on the key format.
   *
   * Scoping to the candidates is what keeps a sweep's memory bounded by its
   * page rather than by the corpus. The whole-table variant this replaced read
   * every successful run for the extractor in one un-LIMITed `SELECT *` and
   * held the resulting Set for the life of the form: measured at 289 bytes per
   * key retained and ~484 bytes per row transient, Form D's ~1M successful runs
   * cost ~300 MB held plus a ~500 MB spike — paid in full by a nightly sweep
   * with two new filings to do, and paid again by every `--shard` process,
   * since each one built the same set. On Postgres the spike is worse than the
   * arithmetic suggests: the driver buffers the whole result set before any JS
   * Set exists.
   *
   * The query keys on `cik` because it leads the primary key
   * `(cik, accession_number, extractor_id, extractor_version)`, so each chunk
   * is an index seek rather than a scan. It is chunked because SQLite binds one
   * parameter per value and stays subject to `SQLITE_MAX_VARIABLE_NUMBER`;
   * Postgres binds the list as one array. There is no two-column `in`, so a
   * chunk also returns that CIK's OTHER accessions — the result is therefore
   * filtered against the candidates' own keys, and a filer with tens of
   * thousands of filings cannot inflate the Set beyond the page that asked
   * for it.
   *
   * Reading per page rather than once per form also closes a staleness window:
   * a multi-hour sweep used to test every batch against a snapshot taken before
   * its first filing was processed.
   */
  async successfulRunKeysForFilings<T extends FilingKey>(
    filings: ReadonlyArray<T>,
    extractor_id: string,
    extractor_version: string,
    form?: string
  ): Promise<Set<string>> {
    const wanted = new Set(filings.map((f) => filingRunKey(f)));
    const found = new Set<string>();
    if (wanted.size === 0) return found;

    // Patch-ceremony reading-side gating: match on major.minor prefix so a row
    // at "1.0.0" satisfies the gate for any "1.0.x" current. A row at "1.1.0"
    // or "2.0.0" does NOT satisfy a "1.0.x" gate.
    //
    // Workglow's tabular query doesn't expose LIKE/prefix matching today, so
    // the criteria narrow by (cik, extractor_id, success, optionally form) and
    // `extractor_version` is post-filtered here.
    const prefix = semverMajorMinorPrefix(extractor_version);
    const ciks = [...new Set(filings.map((f) => f.cik))];

    for (let start = 0; start < ciks.length; start += RUN_CIK_CHUNK) {
      const chunk = ciks.slice(start, start + RUN_CIK_CHUNK);
      const criteria = {
        cik: { value: chunk, operator: "in" as const },
        extractor_id,
        success: true,
      };
      const rows =
        (await this.storage.query(
          (form === undefined ? criteria : { ...criteria, form }) as never
        )) ?? [];
      for (const r of rows) {
        if (!r.extractor_version.startsWith(prefix)) continue;
        // Partial rows have success=true but outcome="partial"; they are NOT
        // "successful enough" — retry-dead-letters should still pick them up.
        if (inferOutcome(r) !== "success") continue;
        const key = filingRunKey(r);
        if (wanted.has(key)) found.add(key);
      }
    }
    return found;
  }
}

/** Key format shared by {@link ExtractorRunRepo.successfulRunKeysForFilings} and its callers. */
export function filingRunKey(f: FilingKey): string {
  return `${f.cik}::${f.accession_number}`;
}
