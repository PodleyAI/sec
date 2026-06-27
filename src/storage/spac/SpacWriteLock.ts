/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SEC_DB_TYPE } from "../../config/tokens";
import { getDb } from "../../util/db";
import { getPgPool } from "../../util/pg";
import type { SpacDealRepositoryStorage } from "./SpacDealSchema";

/**
 * Postgres advisory-lock namespace for SPAC CIK locks. Two-key
 * `pg_advisory_xact_lock(ns, cik)` lets every (cik, this-namespace) pair lock
 * independently of other features' advisory locks. The literal spells "SPAC"
 * in ASCII so it's identifiable in `pg_locks`.
 */
export const PG_ADVISORY_LOCK_NAMESPACE_SPAC = 0x5350_4143;

/** Per-process keyed mutex used by the in-memory / fallback backend. */
const inProcessLocks = new Map<number, Promise<void>>();

async function withInProcessLock<T>(cik: number, fn: () => Promise<T>): Promise<T> {
  const prior = inProcessLocks.get(cik) ?? Promise.resolve();
  let release!: () => void;
  const settled = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Tail of the chain: this caller will hold the slot until `release()`; the
  // next caller chains its `await` onto this settled promise.
  const tail = prior.then(() => settled);
  inProcessLocks.set(cik, tail);
  await prior;
  try {
    return await fn();
  } finally {
    release();
    // Only clear when this caller is still the tail — if a later caller has
    // already chained on, the map entry must keep pointing at their tail.
    if (inProcessLocks.get(cik) === tail) {
      inProcessLocks.delete(cik);
    }
  }
}

/**
 * Run `fn` while holding a per-CIK write lock so that the
 * `getSpac → buildSpacRow → saveSpac` + history snapshot critical section in
 * `SpacReportWriter.rebuild` is serialized across concurrent writers.
 *
 * Dispatch mirrors `cikNameBulkWriter`:
 *   - SQLite (`SEC_DB_TYPE=sqlite`): raw `BEGIN IMMEDIATE`/`COMMIT` on the
 *     shared connection. SQLite is single-writer, so this also serializes
 *     against any other writer holding the database lock.
 *   - Postgres (`SEC_DB_TYPE=postgres`): per-transaction advisory lock keyed
 *     on (`PG_ADVISORY_LOCK_NAMESPACE_SPAC`, `cik`).
 *   - Anything else (in-memory tests / unregistered): per-process keyed
 *     mutex on `cik`.
 *
 * Caveat: this does not yet handle a nested transaction held by the caller.
 * On main, `recomputeAndSaveDeals` issues no inner BEGIN, so the SQLite
 * `BEGIN IMMEDIATE` here is the only transaction in the rebuild stack.
 */
export async function withSpacCikLock<T>(
  cik: number,
  _dealRepo: SpacDealRepositoryStorage,
  fn: () => Promise<T>
): Promise<T> {
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : null;

  if (dbType === "sqlite") {
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn();
      db.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore — the original error is what callers care about
      }
      throw err;
    }
  }

  if (dbType === "postgres") {
    const pool = getPgPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1::int, $2::int)", [
        PG_ADVISORY_LOCK_NAMESPACE_SPAC,
        cik,
      ]);
      const result = await fn();
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    } finally {
      client.release();
    }
  }

  return withInProcessLock(cik, fn);
}
