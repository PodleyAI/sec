/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import { resolveSqlBackend } from "../../util/sqlBackend";

/** One filing on a given day, with just the fields the feed cache writer needs. */
export interface FeedFiling {
  readonly accession_number: string;
  readonly cik: number;
  readonly primary_doc: string;
  readonly form: string | null;
}

function inRange(date: string, from: string | undefined, to: string | undefined): boolean {
  if (from !== undefined && date < from) return false;
  if (to !== undefined && date > to) return false;
  return true;
}

/**
 * Returns the distinct `filing_date` values (YYYY-MM-DD) present in the
 * `filings` table, ascending, optionally bounded by an inclusive `[from, to]`
 * range. These are the days whose Feed tarballs must be fetched to cover every
 * ingested submission — weekends/holidays with no filings naturally never
 * appear, so no non-existent tarball is ever requested.
 */
export async function listFilingDates(
  from: string | undefined,
  to: string | undefined
): Promise<string[]> {
  const backend = resolveSqlBackend();

  if (backend === "sqlite") {
    const db = getDb();
    const clauses: string[] = [];
    const params: string[] = [];
    if (from !== undefined) {
      clauses.push("`filing_date` >= ?");
      params.push(from);
    }
    if (to !== undefined) {
      clauses.push("`filing_date` <= ?");
      params.push(to);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = db
      .prepare<string[], { filing_date: string }>(
        `SELECT DISTINCT \`filing_date\` FROM \`filings\`${where} ORDER BY \`filing_date\` ASC`
      )
      .all(...params);
    return rows.map((r) => r.filing_date).filter((d) => d && inRange(d, from, to));
  }

  if (backend === "postgres") {
    const pool = getPgPool();
    const clauses: string[] = [];
    const params: string[] = [];
    if (from !== undefined) {
      params.push(from);
      clauses.push(`"filing_date" >= $${params.length}`);
    }
    if (to !== undefined) {
      params.push(to);
      clauses.push(`"filing_date" <= $${params.length}`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const res = await pool.query<{ filing_date: string }>(
      `SELECT DISTINCT "filing_date" FROM "filings"${where} ORDER BY "filing_date" ASC`,
      params
    );
    return res.rows.map((r) => r.filing_date).filter((d) => d && inRange(d, from, to));
  }

  // Repository fallback (tests / in-memory backend): stream every row and
  // collect distinct dates. Only exercised on small datasets.
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const dates = new Set<string>();
  for await (const row of repo.records(5000)) {
    if (row.filing_date && inRange(row.filing_date, from, to)) dates.add(row.filing_date);
  }
  return [...dates].sort();
}

/**
 * Returns every filing on a single `filing_date`. The result set is one day of
 * EDGAR (a few thousand rows), so materialising it is cheap; the caller keys it
 * by accession to route each Feed tarball member to its on-disk cache path.
 */
export async function filingsForDate(date: string): Promise<FeedFiling[]> {
  const backend = resolveSqlBackend();

  if (backend === "sqlite") {
    const db = getDb();
    return db
      .prepare<[string], FeedFiling>(
        "SELECT `accession_number`, `cik`, `primary_doc`, `form` FROM `filings` WHERE `filing_date` = ?"
      )
      .all(date);
  }

  if (backend === "postgres") {
    const pool = getPgPool();
    const res = await pool.query<FeedFiling>(
      'SELECT "accession_number", "cik", "primary_doc", "form" FROM "filings" WHERE "filing_date" = $1',
      [date]
    );
    return res.rows;
  }

  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const rows = (await repo.query({ filing_date: date })) ?? [];
  return rows.map((r) => ({
    accession_number: r.accession_number,
    cik: r.cik,
    primary_doc: r.primary_doc,
    form: r.form,
  }));
}
