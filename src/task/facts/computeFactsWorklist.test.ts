/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import type { ProcessedFacts } from "../../storage/processing/ProcessedFactsSchema";
import { computeFactsWorklist } from "./computeFactsWorklist";

function processedRow(
  cik: number,
  last_processed: string,
  success: boolean,
  reason_code: ProcessedFacts["reason_code"] = success ? null : "FETCH_ERROR"
): ProcessedFacts {
  return { cik, last_processed, success, reason_code, detail: null, attempts: success ? 0 : 1 };
}

const RETRY_DATE = "2026-06-10";

describe("computeFactsWorklist", () => {
  it("routes unseen CIKs to needsProcessing and stale CIKs to needsUpdating", () => {
    const result = computeFactsWorklist(
      [
        { cik: 1, last_update: "2026-06-09" },
        { cik: 2, last_update: "2026-06-09" },
        { cik: 3, last_update: "2026-06-01" },
      ],
      new Map([
        [2, processedRow(2, "2026-06-01", true)],
        [3, processedRow(3, "2026-06-05", true)],
      ]),
      { force: false, retryFailed: false, retryDate: RETRY_DATE }
    );
    expect(result.needsProcessing.map((r) => r.cik)).toEqual([1]);
    expect(result.needsUpdating.map((r) => r.cik)).toEqual([2]);
    expect(result.needsRetrying).toEqual([]);
  });

  it("includes failed CIKs only when retryFailed is set, using the retry date", () => {
    const processed = new Map([
      [1, processedRow(1, "2026-06-01", false)],
      [2, processedRow(2, "2026-06-01", true)],
    ]);
    const cikUpdates = [{ cik: 1, last_update: "2026-06-01" }];

    const without = computeFactsWorklist(cikUpdates, processed, {
      force: false,
      retryFailed: false,
      retryDate: RETRY_DATE,
    });
    expect(without.needsRetrying).toEqual([]);
    expect(without.needsUpdating).toEqual([]);

    const withRetry = computeFactsWorklist(cikUpdates, processed, {
      force: false,
      retryFailed: true,
      retryDate: RETRY_DATE,
    });
    expect(withRetry.needsRetrying).toEqual([{ cik: 1, last_update: RETRY_DATE }]);
  });

  it("retries failed CIKs even when they are absent from cik_last_update", () => {
    const result = computeFactsWorklist([], new Map([[9, processedRow(9, "2026-06-01", false)]]), {
      force: false,
      retryFailed: true,
      retryDate: RETRY_DATE,
    });
    expect(result.needsRetrying).toEqual([{ cik: 9, last_update: RETRY_DATE }]);
  });

  it("does not retry a CIK already selected for a freshness update", () => {
    const result = computeFactsWorklist(
      [{ cik: 1, last_update: "2026-06-09" }],
      new Map([[1, processedRow(1, "2026-06-01", false)]]),
      { force: false, retryFailed: true, retryDate: RETRY_DATE }
    );
    expect(result.needsUpdating.map((r) => r.cik)).toEqual([1]);
    expect(result.needsRetrying).toEqual([]);
  });

  it("does not retry NO_XBRL_FACTS rows (recorded as success)", () => {
    const result = computeFactsWorklist(
      [{ cik: 1, last_update: "2026-06-01" }],
      new Map([[1, processedRow(1, "2026-06-01", true, "NO_XBRL_FACTS")]]),
      { force: false, retryFailed: true, retryDate: RETRY_DATE }
    );
    expect(result.needsRetrying).toEqual([]);
    expect(result.needsUpdating).toEqual([]);
  });

  it("force selects every CIK for update regardless of processed state", () => {
    const result = computeFactsWorklist(
      [
        { cik: 1, last_update: "2026-06-01" },
        { cik: 2, last_update: "2026-06-02" },
      ],
      new Map([[1, processedRow(1, "2026-06-05", false)]]),
      { force: true, retryFailed: false, retryDate: RETRY_DATE }
    );
    expect(result.needsUpdating.map((r) => r.cik)).toEqual([1, 2]);
    expect(result.needsProcessing).toEqual([]);
    expect(result.needsRetrying).toEqual([]);
  });
});
