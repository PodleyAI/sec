/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PoolClient } from "pg";
import { globalServiceRegistry } from "workglow";
import { SEC_DB_FOLDER, SEC_DB_NAME, SEC_DB_TYPE } from "../../config/tokens";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import type { SpacDeal, SpacDealRepositoryStorage } from "./SpacDealSchema";

export interface RecomputeSpacDealsArgs {
  readonly dealRepo: SpacDealRepositoryStorage;
  readonly cik: number;
  readonly toDelete: ReadonlyArray<SpacDeal>;
  readonly toUpsert: ReadonlyArray<SpacDeal>;
  /**
   * Optional caller-owned Postgres client. When supplied, the Postgres branch
   * runs DELETE/INSERT directly on this client and does **not** issue
   * BEGIN/COMMIT/ROLLBACK or `release()` — the caller owns the surrounding
   * transaction, so checking out a *second* client from the shared pool here
   * would risk deadlocking once the pool was saturated. When `undefined`, the
   * Postgres branch falls back to its own pool checkout + BEGIN/COMMIT/ROLLBACK
   * wrap — the defensive default that every in-tree caller currently uses.
   */
  readonly pgClient?: PoolClient;
}

/**
 * Atomically delete orphan deal rows and upsert the freshly-derived deals
 * for one SPAC. SQLite uses `better-sqlite3`'s `db.transaction` (the same
 * pattern as {@link replaceForm8KEvents}); Postgres uses an explicit
 * BEGIN/COMMIT on a checked-out client; the in-memory backend falls through
 * to the repository — sequential and synchronous, so a torn write cannot
 * interleave with another caller in tests.
 *
 * Without this guard, a crash, abort signal, or DB hiccup between the
 * delete-orphans pass and the saveDeal upsert would leave the SPAC report
 * row inconsistent with its derived deals (e.g. orphan rows whose
 * `redemption_amount` no longer rolls up).
 */
export async function recomputeSpacDeals(args: RecomputeSpacDealsArgs): Promise<void> {
  const { dealRepo, cik, toDelete, toUpsert, pgClient } = args;

  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  // SEC_DB_TYPE lives in the global ServiceRegistry, which has no unregister
  // API — once any test (or production code path) registers it, it sticks
  // for the lifetime of the process. Trust the actual repo: when it is
  // non-durable (in-memory) take the repo path regardless of dbType, so a
  // stale `sqlite` token from an earlier test cannot route writes for the
  // test's in-memory repo into a real SQLite backend that was never set up.
  const isInMemoryRepo =
    typeof (dealRepo as { isDurable?: () => boolean }).isDurable === "function" &&
    (dealRepo as { isDurable: () => boolean }).isDurable() === false;

  if (
    !isInMemoryRepo &&
    dbType === "sqlite" &&
    globalServiceRegistry.has(SEC_DB_FOLDER) &&
    globalServiceRegistry.has(SEC_DB_NAME)
  ) {
    return replaceSqlite(cik, toDelete, toUpsert);
  }
  if (!isInMemoryRepo && dbType === "postgres") {
    return replacePostgres(cik, toDelete, toUpsert, pgClient);
  }
  return replaceRepository(dealRepo, toDelete, toUpsert);
}

function replaceSqlite(
  _cik: number,
  toDelete: ReadonlyArray<SpacDeal>,
  toUpsert: ReadonlyArray<SpacDeal>
): Promise<void> {
  const db = getDb();
  const delStmt = db.prepare<[number, number], unknown>(
    `DELETE FROM "spac_deal" WHERE "cik" = ? AND "deal_index" = ?`
  );
  // The schema is identical across all backends; column order here matches
  // SpacDealSchema. INSERT OR REPLACE is the SQLite idiom for upsert keyed
  // on the primary key (cik, deal_index).
  const insStmt = db.prepare<
    [
      number,
      number,
      string | null,
      number | null,
      string | null,
      string | null,
      string | null,
      string | null,
      number | null,
      number | null,
      number | null,
      string,
      string | null,
      string | null,
      string,
    ],
    unknown
  >(
    `INSERT OR REPLACE INTO "spac_deal"
      ("cik", "deal_index", "target_name", "target_cik", "announced_date",
       "definitive_agreement_date", "proxy_date", "vote_date", "pipe_amount",
       "redemption_amount", "redemption_shares", "outcome", "outcome_date",
       "source_accession", "created_at")
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(
    (del: ReadonlyArray<SpacDeal>, ups: ReadonlyArray<SpacDeal>) => {
      for (const d of del) {
        delStmt.run(d.cik, d.deal_index);
      }
      for (const d of ups) {
        insStmt.run(
          d.cik,
          d.deal_index,
          d.target_name,
          d.target_cik,
          d.announced_date,
          d.definitive_agreement_date,
          d.proxy_date,
          d.vote_date,
          d.pipe_amount,
          d.redemption_amount,
          d.redemption_shares,
          d.outcome,
          d.outcome_date,
          d.source_accession,
          d.created_at
        );
      }
    }
  );
  tx(toDelete, toUpsert);
  return Promise.resolve();
}

async function replacePostgres(
  _cik: number,
  toDelete: ReadonlyArray<SpacDeal>,
  toUpsert: ReadonlyArray<SpacDeal>,
  pgClient: PoolClient | undefined
): Promise<void> {
  // Caller-supplied client: the surrounding transaction is owned by the
  // caller. Issuing our own BEGIN/COMMIT here would either nest or, more
  // practically, force a second pool checkout — which deadlocks once the pool
  // is saturated. Skip the wrap and the release; the caller cleans up on its
  // own commit/rollback path.
  if (pgClient) {
    await runPostgresOps(pgClient, toDelete, toUpsert);
    return;
  }

  // Defensive default: no outer transaction was provided, so own one.
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await runPostgresOps(client, toDelete, toUpsert);
    await client.query("COMMIT");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore — the surfaced exception below is the meaningful one
    }
    throw e;
  } finally {
    client.release();
  }
}

async function runPostgresOps(
  client: PoolClient,
  toDelete: ReadonlyArray<SpacDeal>,
  toUpsert: ReadonlyArray<SpacDeal>
): Promise<void> {
  for (const d of toDelete) {
    await client.query(
      `DELETE FROM "spac_deal" WHERE "cik" = $1 AND "deal_index" = $2`,
      [d.cik, d.deal_index]
    );
  }
  for (const d of toUpsert) {
    await client.query(
      `INSERT INTO "spac_deal"
        ("cik", "deal_index", "target_name", "target_cik", "announced_date",
         "definitive_agreement_date", "proxy_date", "vote_date", "pipe_amount",
         "redemption_amount", "redemption_shares", "outcome", "outcome_date",
         "source_accession", "created_at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT ("cik", "deal_index") DO UPDATE SET
         "target_name" = EXCLUDED."target_name",
         "target_cik" = EXCLUDED."target_cik",
         "announced_date" = EXCLUDED."announced_date",
         "definitive_agreement_date" = EXCLUDED."definitive_agreement_date",
         "proxy_date" = EXCLUDED."proxy_date",
         "vote_date" = EXCLUDED."vote_date",
         "pipe_amount" = EXCLUDED."pipe_amount",
         "redemption_amount" = EXCLUDED."redemption_amount",
         "redemption_shares" = EXCLUDED."redemption_shares",
         "outcome" = EXCLUDED."outcome",
         "outcome_date" = EXCLUDED."outcome_date",
         "source_accession" = EXCLUDED."source_accession",
         "created_at" = EXCLUDED."created_at"`,
      [
        d.cik,
        d.deal_index,
        d.target_name,
        d.target_cik,
        d.announced_date,
        d.definitive_agreement_date,
        d.proxy_date,
        d.vote_date,
        d.pipe_amount,
        d.redemption_amount,
        d.redemption_shares,
        d.outcome,
        d.outcome_date,
        d.source_accession,
        d.created_at,
      ]
    );
  }
}

/**
 * In-memory fallback used by the test harness. Sequential delete-then-upsert
 * is best-effort atomic: durable atomicity comes from the SQLite/PG paths
 * above. The in-memory repo is synchronous and single-process, so a torn
 * write can't interleave with another caller in tests.
 */
async function replaceRepository(
  repo: SpacDealRepositoryStorage,
  toDelete: ReadonlyArray<SpacDeal>,
  toUpsert: ReadonlyArray<SpacDeal>
): Promise<void> {
  for (const d of toDelete) {
    await repo.delete({ cik: d.cik, deal_index: d.deal_index });
  }
  for (const d of toUpsert) {
    await repo.put(d);
  }
}
