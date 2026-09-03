/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from "csv-parse/sync";

export interface AdvCsv {
  readonly header: readonly string[];
  readonly rows: readonly Record<string, string>[];
}

/**
 * Reads one Form ADV CSV member into its header and header-keyed rows.
 *
 * No column typing and no per-table spec: the point of landing ADV generically
 * is that the SEC's column set is theirs to change. `relax_column_count` is on
 * because real members carry short rows, and losing the rest of a 200,000-row
 * file to one of them is not a trade worth making.
 */
export function parseAdvCsv(text: string): AdvCsv {
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    bom: true,
    trim: true,
  }) as Record<string, string>[];
  const header = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return { header, rows };
}

/**
 * The value under the first header that matches, or undefined.
 *
 * ADV headers differ between the IA and ERA variants of the same table and have
 * been renamed between archives, so a caller names the spellings it knows
 * rather than one that happens to be current.
 */
export function advField(
  row: Record<string, string>,
  ...names: readonly string[]
): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}
