/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseDate } from "../../util/parseDate";

export const DEFAULT_DAILY_INDEX_LOOKBACK = 3;

export function todayEtYYYYdMMdDD(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Calendar add on YYYY-MM-DD via UTC date parts (DST-safe for date-only values). */
export function addIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map((part) => parseInt(part, 10));
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export interface IndexDayPlan {
  /** Completed days to fetch, ascending, including lookback ∩ catch-up, no duplicates. */
  readonly completed: string[];
  /** Today's ET date — fetch if present, never complete. */
  readonly today: string;
  /** Subset of `completed` that must bypass the file cache (last `lookback` completed days). */
  readonly bypassCache: string[];
}

function lookbackDays(today: string, lookback: number): string[] {
  const days: string[] = [];
  for (let offset = 1; offset <= lookback; offset++) {
    days.push(addIsoDate(today, -offset));
  }
  return days;
}

function catchUpDays(start: string, today: string): string[] {
  const days: string[] = [];
  let cursor = addIsoDate(start, 1);
  const yesterday = addIsoDate(today, -1);
  while (cursor <= yesterday) {
    days.push(cursor);
    cursor = addIsoDate(cursor, 1);
  }
  return days;
}

function uniqueSorted(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}

export function planIndexDays(args: {
  readonly lastSuccess: string | undefined;
  readonly fromOverride: string | undefined;
  readonly seed: string | undefined;
  readonly today: string;
  readonly lookback: number;
}): IndexDayPlan {
  const { lastSuccess, fromOverride, seed, today, lookback } = args;
  const start = fromOverride ?? lastSuccess ?? seed ?? today;
  const lookbackSet = lookbackDays(today, lookback);

  const completed =
    start >= today
      ? uniqueSorted(lookbackSet)
      : uniqueSorted([...catchUpDays(start, today), ...lookbackSet]);

  const bypassCache = completed.slice(-lookback);

  return { completed, today, bypassCache };
}

export function dailyIndexCacheRelPath(date: string): string {
  const { year, month, day } = parseDate(date);
  return `daily-index/${year}/${year}-${month}-${day}.master.idx`;
}
