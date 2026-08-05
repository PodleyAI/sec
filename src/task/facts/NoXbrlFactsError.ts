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
  let current: unknown = error;
  // Bounded walk: a wrapper chain is one or two links deep in practice, and a
  // self-referential `cause` must not spin.
  for (let depth = 0; depth < 5; depth++) {
    if (current === null || typeof current !== "object") return false;
    const e = current as { name?: unknown; cause?: unknown; jobError?: unknown };
    if (e.name === NoXbrlFactsError.type) return true;
    current = e.cause ?? e.jobError;
  }
  return false;
}
