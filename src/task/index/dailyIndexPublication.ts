/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "workglow";
import { parseDate } from "../../util/parseDate";
import { SecFetchTask } from "../fetch/SecFetchTask";

/**
 * EDGAR answers 403 — not 404 — for a daily index it never published, and it
 * answers 403 for a client it is refusing (rejected User-Agent, rate limit,
 * blocked egress). The status alone cannot tell those apart, and guessing
 * wrong in the "unpublished" direction advances the cursor past a day whose
 * filings are then never ingested, permanently.
 *
 * Weekends need no request: EDGAR has never published a Saturday or Sunday
 * index. A weekday 403 is the ambiguous case — market holidays are real
 * (Friday 2026-07-03 is a 403) but so is being blocked — and
 * {@link dailyIndexWasPublished} settles it against the quarter listing.
 */
export function isWeekendDate(date: string): boolean {
  const { year, month, day } = parseDate(date);
  // `parseDate` returns a numeric year and zero-padded month/day strings.
  const dow = new Date(Date.UTC(year, parseInt(month, 10) - 1, parseInt(day, 10))).getUTCDay();
  return dow === 0 || dow === 6;
}

function quarterOf(month: string): number {
  return Math.ceil(parseInt(month, 10) / 3);
}

/** `.../daily-index/2026/QTR3/index.json` — the bucket's own file listing. */
export function quarterListingUrl(year: number, quarter: number): string {
  return `https://www.sec.gov/Archives/edgar/daily-index/${year}/QTR${quarter}/index.json`;
}

interface QuarterListing {
  readonly directory?: { readonly item?: ReadonlyArray<{ readonly name?: string }> };
}

/**
 * Dates (`YYYYMMDD`) whose master index the quarter listing names. Memoized per
 * `(year, quarter)` for the life of the process: a catch-up run that crosses
 * two holidays in one quarter asks once, and the listing is small.
 *
 * Not cached to disk — a listing for the CURRENT quarter grows every trading
 * day, and a stale copy would report today's index missing.
 */
const listingCache = new Map<string, Promise<ReadonlySet<string>>>();

export function resetDailyIndexListingCacheForTesting(): void {
  listingCache.clear();
}

async function publishedDatesInQuarter(
  year: number,
  quarter: number,
  context: IExecuteContext
): Promise<ReadonlySet<string>> {
  const key = `${year}-QTR${quarter}`;
  const hit = listingCache.get(key);
  if (hit !== undefined) return hit;
  const pending = (async () => {
    const fetchTask = context.own(
      new SecFetchTask(
        { url: quarterListingUrl(year, quarter), response_type: "text" },
        { title: `Daily-index listing ${key}` }
      )
    );
    let body: string;
    try {
      const result = await fetchTask.run();
      body = result.text ?? "";
    } finally {
      context.disown(fetchTask);
    }
    const listing = JSON.parse(body) as QuarterListing;
    const dates = new Set<string>();
    for (const item of listing.directory?.item ?? []) {
      const match = /^master\.(\d{8})\.idx$/.exec(item.name ?? "");
      if (match !== null) dates.add(match[1]!);
    }
    return dates;
  })();
  listingCache.set(key, pending);
  // A failed probe must not poison the run: the next weekday 403 asks again.
  pending.catch(() => listingCache.delete(key));
  return pending;
}

/**
 * Whether EDGAR published a daily index for `date`, per the quarter listing.
 *
 * Authoritative in both directions, which is the point: the listing loading at
 * all proves this client is not being refused, and the file's absence from a
 * listing that loaded proves the day genuinely has no index. A throw here means
 * neither could be established — the caller must not treat that as "unpublished".
 */
export async function dailyIndexWasPublished(
  date: string,
  context: IExecuteContext
): Promise<boolean> {
  const { year, month, day } = parseDate(date);
  const published = await publishedDatesInQuarter(year, quarterOf(month), context);
  return published.has(`${year}${month}${day}`);
}
