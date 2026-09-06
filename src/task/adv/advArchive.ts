/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Form ADV Part 1A is published as zipped CSV, in two series.
 *
 * The cumulative archive carries everything filed from 2011 through 2024, split
 * into two zips purely by size — both halves are needed for the whole table
 * set. From 2025 onward the SEC publishes one archive per month instead.
 */
export const ADV_BOOTSTRAP_ARCHIVE_URLS: readonly string[] = [
  "https://www.sec.gov/files/adv-filing-data-20111105-20241231-part1.zip",
  "https://www.sec.gov/files/adv-filing-data-20111105-20241231-part2.zip",
];

/** Root folder under `SEC_RAW_DATA_FOLDER` holding every extracted ADV archive. */
export const ADV_FOLDER = "adv";

/**
 * The `snapshot` every cumulative-archive row is stamped with.
 *
 * The two zips are one body of filings covering 2011-11-05 to 2024-12-31, so
 * they share a label rather than borrowing whichever month happened to be
 * ingested alongside them. It sorts below every monthly period, which is what
 * keeps "the newest snapshot" a plain string comparison.
 */
export const ADV_CUMULATIVE_SNAPSHOT = "2011-2024";

const ADV_MONTHLY_BASE_URL = "https://reports.adviserinfo.sec.gov/reports/foia/advFilingData";

/**
 * Earliest month the monthly series publishes. Everything before it lives only
 * in {@link ADV_BOOTSTRAP_ARCHIVE_URLS}, whose cumulative archive ends
 * 2024-12-31.
 */
export const EARLIEST_ADV_PERIOD = "2025-01";

/** True for a `YYYY-MM` string naming a real month. */
export function isAdvPeriod(period: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (match === null) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

/**
 * The monthly archive URL for a `YYYY-MM` period, e.g. `2026-06` ->
 * `.../advFilingData/2026/ADV_Filing_Data_20260601_20260630.zip`.
 *
 * Archives publish roughly a month after the month they cover ends.
 */
export function advArchiveUrlForPeriod(period: string): string {
  if (!isAdvPeriod(period)) {
    throw new Error(`Expected a "YYYY-MM" period, got "${period}"`);
  }
  if (period < EARLIEST_ADV_PERIOD) {
    throw new Error(
      `${period} predates the monthly ADV series (from ${EARLIEST_ADV_PERIOD}). ` +
        `Earlier filings are in the cumulative archive — run \`sec load download adv\`.`
    );
  }
  const [yearStr, monthStr] = period.split("-") as [string, string];
  const lastDay = new Date(Date.UTC(Number(yearStr), Number(monthStr), 0)).getUTCDate();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const start = `${yearStr}${monthStr}01`;
  const end = `${yearStr}${monthStr}${pad(lastDay)}`;
  return `${ADV_MONTHLY_BASE_URL}/${yearStr}/ADV_Filing_Data_${start}_${end}.zip`;
}

/**
 * The folder one snapshot's archive extracts into, and the only folder its
 * ingest reads.
 *
 * Per snapshot, not one shared `adv/`: `unzip` merges members into whatever is
 * already there, so a single folder holds the cumulative archive and every
 * month at once — and an ingest reading it stamps thirteen years of filings
 * with the period it was asked for.
 */
export function advArchiveFolder(snapshot: string): string {
  if (snapshot === ADV_CUMULATIVE_SNAPSHOT) return `${ADV_FOLDER}/cumulative`;
  if (!isAdvPeriod(snapshot)) {
    throw new Error(
      `Expected a "YYYY-MM" period or "${ADV_CUMULATIVE_SNAPSHOT}", got "${snapshot}"`
    );
  }
  return `${ADV_FOLDER}/${snapshot}`;
}

/**
 * The most recent period whose archive can be expected to exist.
 *
 * Two months back, not one: an archive covering a month is published during the
 * month after it, so asking for last month is a 404 for most of the month.
 */
export function latestAvailableAdvPeriod(now: Date = new Date()): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
