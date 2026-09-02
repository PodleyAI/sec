/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import pg from "pg";
import type { ServiceToken } from "workglow";
import { globalServiceRegistry } from "workglow";
import {
  SEC_PG_DATABASE,
  SEC_PG_HOST,
  SEC_PG_PASSWORD,
  SEC_PG_PORT,
  SEC_PG_URL,
  SEC_PG_USER,
} from "../config/tokens";

let pool: pg.Pool | null = null;

function getOptional<T>(token: ServiceToken<T>): T | undefined {
  return globalServiceRegistry.has(token) ? globalServiceRegistry.get(token) : undefined;
}

export function getPgPool(): pg.Pool {
  if (!pool) {
    const url = getOptional(SEC_PG_URL);
    if (url) {
      pool = new pg.Pool({ connectionString: url });
    } else {
      pool = new pg.Pool({
        host: getOptional(SEC_PG_HOST) ?? "localhost",
        port: Number(getOptional(SEC_PG_PORT) ?? "5432"),
        user: getOptional(SEC_PG_USER),
        password: getOptional(SEC_PG_PASSWORD),
        database: getOptional(SEC_PG_DATABASE) ?? "edgar",
      });
    }
  }
  return pool;
}

/**
 * The methods {@link closeIdlePoolClients} needs, which `pg.Pool` satisfies.
 *
 * Stats polls check out whatever is idle and `release(true)` so the backend
 * is closed rather than returned to the pool. A full `Pool` is more than
 * that, and tests pass a fake with only these two members.
 */
export interface IdlePgPool {
  readonly idleCount: number;
  connect(): Promise<{ release(destroy?: boolean | Error): void }>;
}

/**
 * Disconnects every idle client without ending the pool.
 *
 * Repositories capture the singleton `Pool` at bootstrap, so `pool.end()`
 * after a stats poll would leave them holding a dead object. Removing the
 * idle clients leaves the pool usable for the next query while freeing the
 * Postgres backends the rail just used.
 */
export async function closeIdlePoolClients(target: IdlePgPool): Promise<void> {
  const idle = target.idleCount;
  if (idle <= 0) return;
  const clients = await Promise.all(Array.from({ length: idle }, () => target.connect()));
  for (const client of clients) {
    client.release(true);
  }
}

/** Closes idle clients on the process pool, if one has been created. */
export async function closeIdlePgConnections(): Promise<void> {
  if (!pool) return;
  await closeIdlePoolClients(pool);
}

export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
