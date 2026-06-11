/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  PROCESSED_FACTS_REPOSITORY_TOKEN,
  type FactsReasonCode,
  type ProcessedFactsRepositoryStorage,
} from "./ProcessedFactsSchema";

export interface FactsOutcome {
  readonly cik: number;
  readonly date: string;
  readonly success: boolean;
  readonly reason_code: FactsReasonCode | null;
  readonly detail: string | null;
}

const DETAIL_MAX_LENGTH = 1024;

/**
 * Upserts the per-CIK facts processing record. Failures increment `attempts`
 * in place and refresh reason/detail/date; a success resets `attempts` to 0
 * so the row drops out of the `--retry-failed` sweep.
 */
export async function recordFactsOutcome(
  outcome: FactsOutcome,
  repo?: ProcessedFactsRepositoryStorage
): Promise<void> {
  const storage = repo ?? globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN);
  const existing = outcome.success ? undefined : await storage.get({ cik: outcome.cik });
  await storage.put({
    cik: outcome.cik,
    last_processed: outcome.date,
    success: outcome.success,
    reason_code: outcome.reason_code,
    detail: outcome.detail ? outcome.detail.slice(0, DETAIL_MAX_LENGTH) : null,
    attempts: outcome.success ? 0 : (existing?.attempts ?? 0) + 1,
  });
}
