/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { CIK_NAME_REPOSITORY_TOKEN, type CikNameType } from "../../storage/entity/CikNameSchema";
import type { QueryResult } from "./EntityQuery";

export interface CikQueryParams {
  readonly name?: string;
  readonly exact?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

export interface CikQueryResult extends QueryResult<CikNameType> {
  readonly tableEmpty: boolean;
}

/**
 * Queries the `cik_names` table for companies whose name matches the given needle.
 * Case-insensitive. Ranks exact match first, then prefix, then substring;
 * ties broken by shorter name, then lower CIK.
 *
 * `tableEmpty` is true when the underlying table has no rows at all (distinct
 * from "no matches") so callers can prompt the user to run the ingest.
 */
export async function queryCiks(params: CikQueryParams): Promise<CikQueryResult> {
  const repo = globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;
  const needle = params.name?.toLowerCase().trim() ?? "";

  const matches: { row: CikNameType; rank: number }[] = [];
  let anyRowSeen = false;
  for await (const row of repo.records(5000)) {
    anyRowSeen = true;
    if (row.name === null || row.name === undefined) continue;
    const hay = row.name.toLowerCase();
    let rank: number;
    if (params.exact) {
      if (hay !== needle) continue;
      rank = 0;
    } else if (needle === "" || hay === needle) {
      rank = 0;
    } else if (hay.startsWith(needle)) {
      rank = 1;
    } else if (hay.includes(needle)) {
      rank = 2;
    } else {
      continue;
    }
    matches.push({ row, rank });
  }

  matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.row.name ?? "").length - (b.row.name ?? "").length ||
      a.row.cik - b.row.cik
  );

  return {
    rows: matches.slice(offset, offset + limit).map((m) => m.row),
    total: matches.length,
    tableEmpty: !anyRowSeen,
  };
}
