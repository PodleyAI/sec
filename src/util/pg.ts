/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import pg from "pg";
import type { ServiceToken } from "@workglow/util";
import { globalServiceRegistry } from "@workglow/util";
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

export async function closePgPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
