/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN,
  EXPECTED_NEGATIVE_EXTRACTOR_IDS,
  EXPECTED_NEGATIVE_REASON_CODES,
  MODEL_ERROR_REASON_CODES,
  NONDETERMINISTIC_REASON_CODES,
  NONDETERMINISTIC_RETRY_ATTEMPTS,
  type DeadLetterReasonCode,
  type ExtractionDeadLetter,
  type ExtractionDeadLetterRepositoryStorage,
} from "./ExtractionDeadLetterSchema";

const MODEL_ERROR_REASONS: ReadonlySet<string> = new Set(MODEL_ERROR_REASON_CODES);
const NONDETERMINISTIC_REASONS: ReadonlySet<string> = new Set(NONDETERMINISTIC_REASON_CODES);
const EXPECTED_NEGATIVE_EXTRACTORS: ReadonlySet<string> = new Set(EXPECTED_NEGATIVE_EXTRACTOR_IDS);
const EXPECTED_NEGATIVE_REASONS: ReadonlySet<string> = new Set(EXPECTED_NEGATIVE_REASON_CODES);

/** Ids per `in`-list query. SQLite binds one parameter per value. */
const MAX_IDS_PER_QUERY = 900;

export function isExpectedNegativeDeadLetter(row: ExtractionDeadLetter): boolean {
  return (
    EXPECTED_NEGATIVE_EXTRACTORS.has(row.extractor_id) &&
    EXPECTED_NEGATIVE_REASONS.has(row.reason_code)
  );
}

export function isEligibleDeadLetter(
  row: ExtractionDeadLetter,
  currentVersion: string
): boolean {
  return (
    row.failed_extractor_version !== currentVersion ||
    MODEL_ERROR_REASONS.has(row.reason_code) ||
    isExpectedNegativeDeadLetter(row) ||
    (NONDETERMINISTIC_REASONS.has(row.reason_code) &&
      row.attempts < NONDETERMINISTIC_RETRY_ATTEMPTS)
  );
}

export interface DeadLetterInput {
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly section_name: string;
  /**
   * Constrained to the declared vocabulary rather than left as `string`. The
   * stored column is a plain string, so a code written here but missing from
   * {@link DEAD_LETTER_REASON_CODES} used to persist silently — which is how
   * `UNVERIFIED_SOURCE_SPAN` and `SOURCE_SPAN_TOO_LONG` were both written for
   * some time without ever appearing in the list an operator reads. Typing the
   * input makes that drift a compile error.
   */
  readonly reason_code: DeadLetterReasonCode;
  readonly detail: string | null;
  readonly failed_extractor_version: string;
  readonly source_run_id: string | null;
}

export class ExtractionDeadLetterRepo {
  private readonly storage: ExtractionDeadLetterRepositoryStorage;

  constructor(storage?: ExtractionDeadLetterRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);
  }

  async get(
    extractor_id: string,
    accession_number: string,
    section_name: string
  ): Promise<ExtractionDeadLetter | undefined> {
    return this.storage.get({ extractor_id, accession_number, section_name });
  }

  /**
   * Records (or re-records) a version-fixable failure. Re-failure refreshes
   * reason/version/timestamps; status resets to pending so a
   * previously-resolved-then-failed-again entry is re-surfaced.
   *
   * `attempts` counts CONSECUTIVE failures of the current
   * `(reason_code, failed_extractor_version)` pair, restarting at 1 whenever
   * either changes. A dead-letter row is keyed by section, not by failure, so a
   * lifetime counter is shared across every reason code and version the section
   * ever hit — and {@link listEligible} spends it on a decision scoped to one
   * pair. A section that failed span verification three times under an older
   * version would otherwise arrive at its FIRST bounded-retry failure already
   * over budget and get zero retries, making that path inert for exactly the
   * entries it exists to recover.
   */
  async record(input: DeadLetterInput): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.get(input.extractor_id, input.accession_number, input.section_name);
    const sameFailure =
      existing !== undefined &&
      existing.reason_code === input.reason_code &&
      existing.failed_extractor_version === input.failed_extractor_version;
    await this.storage.put({
      extractor_id: input.extractor_id,
      accession_number: input.accession_number,
      section_name: input.section_name,
      reason_code: input.reason_code,
      detail: input.detail,
      failed_extractor_version: input.failed_extractor_version,
      status: "pending",
      attempts: sameFailure ? existing.attempts + 1 : 1,
      first_seen_at: existing?.first_seen_at ?? now,
      last_attempt_at: now,
      source_run_id: input.source_run_id,
    });
  }

  /**
   * Marks the section clean. `attempts` is zeroed explicitly rather than
   * inherited through the spread: it counts CONSECUTIVE failures, and a clean
   * run ends the streak.
   */
  async markResolved(
    extractor_id: string,
    accession_number: string,
    section_name: string
  ): Promise<void> {
    const existing = await this.get(extractor_id, accession_number, section_name);
    if (!existing) return;
    await this.storage.put({
      ...existing,
      status: "resolved",
      attempts: 0,
      last_attempt_at: new Date().toISOString(),
    });
  }

  async listPending(extractor_id: string): Promise<ExtractionDeadLetter[]> {
    const rows = (await this.storage.query({ extractor_id })) ?? [];
    return rows.filter((r) => r.status === "pending");
  }

  /**
   * Pending entries whose accession is in `accession_numbers`. Used to scope a
   * listing to one issuer: dead letters have no CIK, and EDGAR accessions are
   * often the filing agent's, so the caller joins `filings` first.
   *
   * An empty list returns immediately — `IN ()` is invalid SQL.
   */
  async listPendingByAccessions(
    accession_numbers: readonly string[],
    extractor_id: string | undefined = undefined
  ): Promise<ExtractionDeadLetter[]> {
    if (accession_numbers.length === 0) return [];
    const distinct = [...new Set(accession_numbers)];
    const out: ExtractionDeadLetter[] = [];
    for (let start = 0; start < distinct.length; start += MAX_IDS_PER_QUERY) {
      const chunk = distinct.slice(start, start + MAX_IDS_PER_QUERY);
      const rows =
        (await this.storage.query({
          accession_number: { value: chunk, operator: "in" },
          status: "pending",
          ...(extractor_id !== undefined ? { extractor_id } : {}),
        })) ?? [];
      out.push(...rows);
    }
    return out;
  }

  /**
   * Pending entries eligible for retry. Four ways in:
   *
   * - the failing version differs from the current version — the usual
   *   version-fixable path;
   * - the reason code is a model/provider-availability error
   *   ({@link MODEL_ERROR_REASON_CODES}), which a version bump does not address:
   *   those recover by re-running once the model is registered, unbounded;
   * - LOI / redemption `MODEL_EMPTY` / `MODEL_INVALID_OUTPUT` — expected
   *   negatives that should be marked resolved rather than re-paid as AI;
   * - the reason code is a non-deterministic model response
   *   ({@link NONDETERMINISTIC_REASON_CODES}), which the next call may well get
   *   right — but only for {@link NONDETERMINISTIC_RETRY_ATTEMPTS} recorded
   *   attempts, after which it falls back to the version gate rather than
   *   re-paying the AI cost of an ambiguous section on every sweep forever.
   */
  async listEligible(
    extractor_id: string,
    currentVersion: string
  ): Promise<ExtractionDeadLetter[]> {
    return (await this.listPending(extractor_id)).filter((r) =>
      isEligibleDeadLetter(r, currentVersion)
    );
  }

  async countEligible(extractor_id: string, currentVersion: string): Promise<number> {
    return (await this.listEligible(extractor_id, currentVersion)).length;
  }
}
