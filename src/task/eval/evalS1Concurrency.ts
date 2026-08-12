/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Default `MapTask.concurrencyLimit` for `eval s1` section fan-out. */
export const EVAL_S1_CONCURRENCY_DEFAULT = 5;

/** Resolve `--concurrency` / task input. `undefined` → default. Rejects `< 1`. */
export function resolveEvalS1Concurrency(value: number | undefined): number {
  if (value === undefined) return EVAL_S1_CONCURRENCY_DEFAULT;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`concurrency must be an integer >= 1, got ${String(value)}`);
  }
  return value;
}
