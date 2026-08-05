/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskError } from "workglow";

/**
 * Thrown when a companyfacts payload carries no `facts` object — the CIK exists
 * but files no XBRL financial data.
 *
 * data.sec.gov signals this with `200` and a two-byte `{}` body, not the `404`
 * it returns for an unknown CIK, so it cannot be recognized by HTTP status.
 * It is the normal shape for filers with no financial-statement XBRL: funds,
 * insurance separate accounts, and broker-dealers filing 497 / 485BPOS /
 * NPORT-P / X-17A-5 (e.g. CIK 3521 "ALGER FUNDS"). Terminal, not a defect:
 * {@link classifyFactsFetchError} maps it to `NO_XBRL_FACTS` so the CIK is
 * recorded as a success and drops out of the `update facts --retry-failed`
 * sweep instead of failing identically on every run.
 */
export class NoXbrlFactsError extends TaskError {
  static override readonly type: string = "NoXbrlFactsError";

  constructor(cik: number) {
    super(`Company facts JSON for CIK ${cik} has no 'facts' object`);
  }
}

/**
 * True for a {@link NoXbrlFactsError}, including one wrapped by the task/job
 * layer (`cause` / `jobError`). Checked by name rather than `instanceof` —
 * the prototype identity can differ across module/realm boundaries.
 */
export function isNoXbrlFactsError(error: unknown): boolean {
  // Breadth-first over BOTH links rather than `cause ?? jobError`: the job layer
  // wraps a task failure carrying a generic `cause` alongside the real
  // `jobError`, and following only `cause` terminates before ever reaching the
  // typed error — recording a companyfacts 404 as a retryable failure, which is
  // the retry loop `NO_XBRL_FACTS` exists to break.
  const queue: unknown[] = [error];
  const seen = new Set<object>();
  while (queue.length > 0 && seen.size < 32) {
    const current = queue.shift();
    if (current === null || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    const e = current as { name?: unknown; cause?: unknown; jobError?: unknown };
    if (e.name === NoXbrlFactsError.type) return true;
    queue.push(e.cause, e.jobError);
  }
  return false;
}
