/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "..", "__fixtures__", "inline-path");

/**
 * A canonical id is minted fresh on every run, so rows carrying one cannot be
 * compared to a recorded set directly. Each distinct id is replaced by its
 * rank — `#0`, `#1`, … — in the order the ids first appear once the rows are
 * sorted by every OTHER compared column. That makes the labelling a function
 * of the tenures themselves: two runs that grouped the same rows under the
 * same ids agree, and a run that grouped them differently relabels and fails.
 *
 * Which is the whole point. What a recorded set can still prove, once the path
 * that produced it is gone, is that today's rebuild puts the same rows under
 * the same PARTITION — who shares an identity with whom — and agrees on every
 * other column exactly.
 */
export function labelCanonicalIds<T extends Record<string, unknown>>(
  rows: readonly T[],
  idColumn: keyof T & string
): T[] {
  const withoutId = (row: T): string =>
    JSON.stringify(
      Object.keys(row)
        .filter((k) => k !== idColumn)
        .sort()
        .map((k) => [k, row[k]])
    );
  const ordered = [...rows].sort((a, b) => {
    const left = withoutId(a);
    const right = withoutId(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const labels = new Map<unknown, string>();
  for (const row of ordered) {
    if (!labels.has(row[idColumn])) labels.set(row[idColumn], `#${labels.size}`);
  }
  return ordered
    .map((row) => ({ ...row, [idColumn]: labels.get(row[idColumn])! }))
    .sort((a, b) => {
      const left = JSON.stringify(a);
      const right = JSON.stringify(b);
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

/** The rows the incremental path produced for one scenario, recorded once. */
export function readInlinePathRows<T>(key: string): T[] {
  return JSON.parse(readFileSync(join(DIR, `${key}.json`), "utf-8")) as T[];
}
