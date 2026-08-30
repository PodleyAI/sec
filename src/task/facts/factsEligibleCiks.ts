/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  ENTITY_REPOSITORY_TOKEN,
  type EntityRepositoryStorage,
} from "../../storage/entity/EntitySchema";
import {
  FILING_REPOSITORY_TOKEN,
  type FilingRepositoryStorage,
} from "../../storage/filing/FilingSchema";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import { resolveSqlBackend } from "../../util/sqlBackend";

/**
 * CIKs plausibly holding a `companyfacts` document, used to bound the
 * never-processed facts lane.
 *
 * The CIK universe is ~982k, but only ~25k have ever been fetched and the vast
 * majority of the rest are Section 16 reporting persons (natural people), who
 * have no XBRL and answer companyfacts with a 404. Sweeping them costs one SEC
 * round trip each for a guaranteed miss.
 *
 * Two signals, unioned, measured against the 25,013 already-classified CIKs in
 * `processed_facts`:
 *
 * | filter                | backlog kept | recall |
 * |-----------------------|--------------|--------|
 * | `sic` present         | ~56,800      | 86.0%  |
 * | any XBRL filing       | ~12,300      | 94.2%  |
 * | **either (this one)** | **~67,600**  | 95.1%  |
 *
 * SIC alone was the obvious filter and is the weaker one: EDGAR increasingly
 * omits SIC for new registrants (of CIKs first filing in 2025 or later, only
 * 1,280 of 80,174 carry one), so it drops real issuers. The XBRL flags catch
 * those, and SIC catches older filers who predate XBRL. The residual ~5% miss
 * is registered funds (N-CEN/485BPOS/497/S-6) whose companyfacts is dei-only.
 *
 * NOTE: the XBRL half is only as good as the `filings.is_xbrl` backfill — those
 * columns were NULL for the whole corpus until the `TypeSECBoolean` decode fix,
 * so on an un-backfilled database this degrades to the SIC-only filter rather
 * than silently keeping nothing.
 */
export async function listFactsEligibleCiks(): Promise<Set<number>> {
  const filingRepo = globalServiceRegistry.has(FILING_REPOSITORY_TOKEN)
    ? globalServiceRegistry.get(FILING_REPOSITORY_TOKEN)
    : undefined;
  const backend = resolveSqlBackend("read", filingRepo);
  const eligible = new Set<number>();

  if (backend === "sqlite") {
    const db = getDb();
    const xbrl = db
      .prepare<[], { cik: number }>(
        "SELECT DISTINCT `cik` FROM `filings` WHERE `is_xbrl` = 1 OR `is_inline_xbrl` = 1 OR `is_xbrl_numeric` = 1"
      )
      .all();
    for (const row of xbrl) eligible.add(Number(row.cik));
    const sic = db
      .prepare<[], { cik: number }>("SELECT `cik` FROM `entities` WHERE `sic` IS NOT NULL")
      .all();
    for (const row of sic) eligible.add(Number(row.cik));
    return eligible;
  }

  if (backend === "postgres") {
    const pool = getPgPool();
    const res = await pool.query<{ cik: string | number }>(
      `SELECT DISTINCT "cik" FROM "filings"
         WHERE "is_xbrl" OR "is_inline_xbrl" OR "is_xbrl_numeric"
       UNION
       SELECT "cik" FROM "entities" WHERE "sic" IS NOT NULL`
    );
    for (const row of res.rows) eligible.add(Number(row.cik));
    return eligible;
  }

  // Repository fallback (tests / in-memory backend): stream both tables. Only
  // exercised on small datasets.
  const filings =
    filingRepo ?? (globalServiceRegistry.get(FILING_REPOSITORY_TOKEN) as FilingRepositoryStorage);
  for await (const row of filings.records(5000)) {
    if (row.is_xbrl || row.is_inline_xbrl || row.is_xbrl_numeric) eligible.add(Number(row.cik));
  }
  const entities = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN) as EntityRepositoryStorage;
  for await (const row of entities.records(5000)) {
    if (row.sic !== null && row.sic !== undefined) eligible.add(Number(row.cik));
  }
  return eligible;
}
