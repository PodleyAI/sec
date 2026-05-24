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
 * Soft cap on substring/prefix matches we'll collect before sorting. Stops
 * the empty-needle case (which previously walked the entire ~1M-row table)
 * and any pathologically broad needle from exhausting memory. Picked so a
 * normal `offset+limit` of a few hundred has plenty of headroom for the
 * rank-based reordering.
 */
const MAX_FUZZY_MATCHES = 1000;

/**
 * Queries the `cik_names` table for companies whose name matches the given
 * needle. Case-insensitive. Ranks exact match first, then prefix, then
 * substring; ties broken by shorter name, then lower CIK.
 *
 * `tableEmpty` is true when the underlying table has no rows at all
 * (distinct from "no matches") so callers can prompt the user to run the
 * ingest.
 *
 * Two operating modes:
 *
 *   1. **Empty needle** — `size() + getOffsetPage()`. No scan, no
 *      sorting. The "rank" concept doesn't apply because there's no
 *      target; rows come back in PK order.
 *   2. **Exact / prefix / substring** — streams via `records()` because
 *      workglow has no LIKE operator AND its equality is case-sensitive
 *      (so even `--exact` can't push down: SEC stores names as
 *      "Apple Inc." and a user querying "APPLE INC." would miss). Capped
 *      at `MAX_FUZZY_MATCHES` so the worst case is bounded; if the cap
 *      fires, `totalApprox.exhausted` is `false` and the UI renders
 *      "≥ N".
 */
export async function queryCiks(params: CikQueryParams): Promise<CikQueryResult> {
  const repo = globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
  const limit = params.limit ?? 25;
  const offset = params.offset ?? 0;
  const needle = params.name?.toLowerCase().trim() ?? "";

  // Mode 1: empty needle — straight pagination.
  if (needle === "" && !params.exact) {
    const total = await repo.size();
    const rows = (await repo.getOffsetPage(offset, limit)) ?? [];
    return { rows, total, tableEmpty: total === 0 };
  }

  // Mode 2/3: stream and rank. We have to stream rather than `query()`
  // because workglow's equality is case-sensitive and there is no LIKE
  // operator — both case-insensitive exact match and prefix/substring
  // matches have to be evaluated client-side. Capped at MAX_FUZZY_MATCHES
  // so the worst case is bounded; if the cap fires, `totalApprox.exhausted`
  // is `false` and the UI renders "≥ N".
  const matches: { row: CikNameType; rank: number }[] = [];
  let anyRowSeen = false;
  let exhausted = true;
  for await (const row of repo.records(5000)) {
    anyRowSeen = true;
    if (row.name === null || row.name === undefined) continue;
    const hay = row.name.toLowerCase();
    let rank: number;
    if (params.exact) {
      if (hay !== needle) continue;
      rank = 0;
    } else if (hay === needle) {
      rank = 0;
    } else if (hay.startsWith(needle)) {
      rank = 1;
    } else if (hay.includes(needle)) {
      rank = 2;
    } else {
      continue;
    }
    matches.push({ row, rank });
    if (matches.length >= MAX_FUZZY_MATCHES) {
      exhausted = false;
      break;
    }
  }

  matches.sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.row.name ?? "").length - (b.row.name ?? "").length ||
      a.row.cik - b.row.cik
  );

  // If we hit the cap, we don't know the true total — surface it as a
  // lower bound so the renderer says "≥ N". When the stream drained
  // (exhausted), matches.length IS the exact total and we omit
  // totalApprox entirely so consumers can rely on its presence as the
  // streamed-and-capped signal.
  // tableEmpty stays correct because we still see at least one row
  // before hitting the cap unless the table is empty.
  return {
    rows: matches.slice(offset, offset + limit).map((m) => m.row),
    total: matches.length,
    tableEmpty: !anyRowSeen,
    ...(exhausted ? {} : { totalApprox: { atLeast: matches.length, exhausted: false } }),
  };
}
