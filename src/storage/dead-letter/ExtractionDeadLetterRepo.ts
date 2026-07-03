/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN,
  MODEL_ERROR_REASON_CODES,
  type ExtractionDeadLetter,
  type ExtractionDeadLetterRepositoryStorage,
} from "./ExtractionDeadLetterSchema";

const MODEL_ERROR_REASONS: ReadonlySet<string> = new Set(MODEL_ERROR_REASON_CODES);

export interface DeadLetterInput {
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly section_name: string;
  readonly reason_code: string;
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
   * Records (or re-records) a version-fixable failure. Re-failure increments
   * attempts in place and refreshes reason/version/timestamps; status resets to
   * pending so a previously-resolved-then-failed-again entry is re-surfaced.
   */
  async record(input: DeadLetterInput): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.get(input.extractor_id, input.accession_number, input.section_name);
    await this.storage.put({
      extractor_id: input.extractor_id,
      accession_number: input.accession_number,
      section_name: input.section_name,
      reason_code: input.reason_code,
      detail: input.detail,
      failed_extractor_version: input.failed_extractor_version,
      status: "pending",
      attempts: (existing?.attempts ?? 0) + 1,
      first_seen_at: existing?.first_seen_at ?? now,
      last_attempt_at: now,
      source_run_id: input.source_run_id,
    });
  }

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
      last_attempt_at: new Date().toISOString(),
    });
  }

  async listPending(extractor_id: string): Promise<ExtractionDeadLetter[]> {
    const rows = (await this.storage.query({ extractor_id })) ?? [];
    return rows.filter((r) => r.status === "pending");
  }

  /**
   * Pending entries eligible for retry: either the failing version differs from
   * the current version (the usual version-fixable path), OR the reason code is a
   * model/provider-availability error ({@link MODEL_ERROR_REASON_CODES}), which a
   * version bump does not address — those recover by re-running once the model is
   * registered, so they stay eligible under the same version.
   */
  async listEligible(
    extractor_id: string,
    currentVersion: string
  ): Promise<ExtractionDeadLetter[]> {
    return (await this.listPending(extractor_id)).filter(
      (r) => r.failed_extractor_version !== currentVersion || MODEL_ERROR_REASONS.has(r.reason_code)
    );
  }

  async countEligible(extractor_id: string, currentVersion: string): Promise<number> {
    return (await this.listEligible(extractor_id, currentVersion)).length;
  }
}
