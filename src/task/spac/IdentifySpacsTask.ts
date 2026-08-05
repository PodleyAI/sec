/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, TaskAbortedError } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  type SpacCandidate,
  type SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";
import { classifySpacCandidate } from "./classifySpacCandidate";
import { scanSpacCandidates } from "./spacCandidateScan";

/** Rows per bulk write. A full scan writes a few thousand rows in total. */
const WRITE_BATCH = 1_000;

/**
 * CIKs per `in`-list query. SQLite binds one parameter per value and stays
 * subject to SQLITE_MAX_VARIABLE_NUMBER (999 on builds predating SQLite 3.32),
 * so the list is chunked below it; Postgres binds the whole list as one array.
 */
const MAX_IDS_PER_QUERY = 900;

export type IdentifySpacsTaskInput = {
  /** Rescan every entity instead of only those whose submissions changed. */
  readonly full?: boolean;
};

export type IdentifySpacsTaskOutput = {
  readonly success: boolean;
  readonly scanned: number;
  readonly identified: number;
  readonly high: number;
  readonly medium: number;
  readonly low: number;
  readonly pruned: number;
  /** The watermark used, or null for a full scan. */
  readonly since: string | null;
};

/** `identified_at` is an ISO timestamp; the watermark compares on its date. */
function isoDate(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * Identifies SPACs from submissions metadata and refreshes `spac_candidate`.
 *
 * Runs in two modes. A **full** scan grades every entity that is coded a blank
 * check, is named like one, or ever was. An **incremental** scan (the default)
 * looks only at CIKs whose submissions were reprocessed since the last run,
 * which is what the daily update needs: a new SPAC arrives as a new
 * registration, and a de-SPAC arrives as a rename, and both restate the
 * company's submissions.
 *
 * The watermark is the newest `identified_at` already in the table, so the task
 * carries no separate cursor to fall out of sync — an empty table simply means
 * a full scan. It is taken back one day because `processed_submissions.last_
 * processed` has date granularity: a CIK processed later on the same day as the
 * previous run would otherwise be skipped forever.
 *
 * A CIK that no longer matches any signal is deleted, so the table cannot
 * accumulate rows for companies that have been recoded or renamed out of the
 * candidate set. In incremental mode only the rescanned CIKs are eligible for
 * pruning — an untouched row is not evidence of anything, so it is left alone.
 */
export class IdentifySpacsTask extends Task<IdentifySpacsTaskInput, IdentifySpacsTaskOutput> {
  static readonly type = "IdentifySpacsTask";
  static readonly category = "SEC";
  static readonly title = "Identify SPACs from submissions";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({ full: Type.Optional(Type.Boolean()) });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
      scanned: Type.Integer(),
      identified: Type.Integer(),
      high: Type.Integer(),
      medium: Type.Integer(),
      low: Type.Integer(),
      pruned: Type.Integer(),
      since: Type.Union([Type.String(), Type.Null()]),
    });
  }

  async execute(
    input: IdentifySpacsTaskInput,
    context: IExecuteContext
  ): Promise<IdentifySpacsTaskOutput> {
    const repo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    const identifiedAt = new Date().toISOString();

    const since = input.full === true ? null : await this.watermark();
    if (isDryRun()) {
      console.log(
        since === null
          ? "Would scan every entity for SPAC candidates"
          : `Would scan entities whose submissions changed since ${since} for SPAC candidates`
      );
      return {
        success: true,
        scanned: 0,
        identified: 0,
        high: 0,
        medium: 0,
        low: 0,
        pruned: 0,
        since,
      };
    }

    const facts = await scanSpacCandidates(since === null ? {} : { since });
    if (context.signal?.aborted) throw new TaskAbortedError();

    const rows: SpacCandidate[] = [];
    for (const fact of facts) {
      const row = classifySpacCandidate(fact, identifiedAt);
      if (row !== null) rows.push(row);
    }

    let written = 0;
    for (let i = 0; i < rows.length; i += WRITE_BATCH) {
      if (context.signal?.aborted) throw new TaskAbortedError();
      const batch = rows.slice(i, i + WRITE_BATCH);
      await repo.putBulk(batch);
      written += batch.length;
      context.updateProgress(
        Math.floor((written / Math.max(rows.length, 1)) * 100),
        `${written}/${rows.length} candidates`
      );
    }

    const pruned = await this.prune(new Set(rows.map((r) => r.cik)), since);

    // `TypeStringEnum` widens to `string` in the static type (the enum lives in
    // the JSON schema, not the TS type), so narrow back to the union here.
    const counts: Record<SpacCandidateConfidence, number> = { high: 0, medium: 0, low: 0 };
    for (const row of rows) counts[row.confidence as SpacCandidateConfidence]++;

    console.log(
      `SPAC candidates: ${rows.length} identified ` +
        `(${counts.high} high, ${counts.medium} medium, ${counts.low} low)` +
        `${pruned > 0 ? `, ${pruned} pruned` : ""}` +
        `${since === null ? " [full scan]" : ` [since ${since}]`}`
    );

    return {
      success: true,
      scanned: facts.length,
      identified: rows.length,
      ...counts,
      pruned,
      since,
    };
  }

  /**
   * Deletes rows for CIKs the scan just considered and did not match.
   *
   * A full scan considered every entity, so anything absent from `matched` is
   * stale by definition. An incremental scan only looked at CIKs whose
   * submissions changed, so a row is only stale if its CIK was in that set —
   * an untouched row is simply unexamined, and deleting it would silently empty
   * the table one daily run at a time.
   */
  private async prune(matched: ReadonlySet<number>, since: string | null): Promise<number> {
    const repo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);

    const unmatched: number[] = [];
    for await (const row of repo.records(1000)) {
      if (!matched.has(row.cik)) unmatched.push(row.cik);
    }

    // A full scan considered every entity, so every unmatched row is stale.
    const stale =
      since === null ? unmatched : await this.processedSince(unmatched, since, MAX_IDS_PER_QUERY);
    for (const cik of stale) await repo.delete({ cik });
    return stale.length;
  }

  /**
   * Of `ciks`, those whose submissions were (re)processed on or after `since`.
   *
   * One `in`-list query per chunk rather than one `get` per CIK: the candidate
   * table holds thousands of rows and an incremental run matches a handful, so
   * the per-CIK form is an N+1 over almost the whole table on every daily run.
   * Chunked because SQLite binds one parameter per value in an `in` list.
   */
  private async processedSince(
    ciks: ReadonlyArray<number>,
    since: string,
    chunkSize: number
  ): Promise<number[]> {
    if (ciks.length === 0) return [];
    const processed = globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN);
    const recent: number[] = [];
    for (let start = 0; start < ciks.length; start += chunkSize) {
      const chunk = ciks.slice(start, start + chunkSize);
      const rows = (await processed.query({ cik: { value: chunk, operator: "in" } })) ?? [];
      for (const row of rows) {
        if (row.last_processed >= since) recent.push(row.cik);
      }
    }
    return recent;
  }

  /**
   * Newest `identified_at` in the table, minus one day, as YYYY-MM-DD. Null
   * when the table is empty, which promotes the run to a full scan.
   */
  private async watermark(): Promise<string | null> {
    const repo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    let newest: string | null = null;
    for await (const row of repo.records(1000)) {
      if (newest === null || row.identified_at > newest) newest = row.identified_at;
    }
    if (newest === null) return null;
    const previous = new Date(newest);
    if (Number.isNaN(previous.getTime())) return null;
    previous.setUTCDate(previous.getUTCDate() - 1);
    return isoDate(previous.toISOString());
  }
}
