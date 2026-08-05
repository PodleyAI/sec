/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Pool, RateLimiterStorageOptions } from "workglow";
import { PostgresRateLimiterStorage } from "workglow";
import { createSecFetchRateLimiterStorage } from "../task/fetch/SecJobQueue";
import {
  rateLimiterStorageTableNames,
  SecFetchRateLimiterOptions,
  secFetchRateLimiterTableNames,
} from "../task/fetch/secFetchRateLimiterConfig";
import { ownedTableNames } from "./resetAllDatabases";

/**
 * Drift guard for `sec db reset --confirm`. The SQL backends drop the schema
 * outright, but the in-memory fallback still truncates a hand-maintained list
 * of repository tokens; if a new table is registered in DefaultDI but its
 * `deleteAll()` is forgotten there, a "reset" on that backend silently leaves
 * the table fully populated (orphan rows + dangling cross-tier references).
 *
 * This mirrors `form-wiring.test.ts`: it pins the data/wiring consistency at the
 * source level so a forgotten table fails CI instead of corrupting a "clean" DB.
 */
function repositoryTokens(relativePath: string): Set<string> {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const tokens = source.match(/[A-Z0-9_]+_REPOSITORY_TOKEN/g) ?? [];
  return new Set(tokens);
}

describe("resetAllDatabases token coverage", () => {
  it("truncates every repository token registered in DefaultDI", () => {
    const registered = repositoryTokens("./DefaultDI.ts");
    const reset = repositoryTokens("./resetAllDatabases.ts");

    const missing = [...registered].filter((token) => !reset.has(token)).sort();
    expect(missing).toEqual([]);
  });
});

/**
 * Runs a rate-limiter storage's own migrations against a pool that records SQL
 * instead of executing it, and returns the tables the DDL actually creates.
 * That is the authority on what a reset has to drop — not a name written down
 * on this side of the boundary.
 */
async function tablesCreatedBy(storage: PostgresRateLimiterStorage): Promise<string[]> {
  const statements: string[] = [];
  const recordingPool = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: [] };
    },
  } as unknown as Pool;
  for (const migration of storage.getMigrations()) {
    await migration.up(recordingPool);
  }
  return statements
    .flatMap((sql) => [...sql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([A-Za-z0-9_]+)/g)])
    .map((match) => match[1]!)
    .sort();
}

describe("rate-limiter table ownership", () => {
  it("drops exactly the tables the configured rate-limiter storage creates", async () => {
    const created = await tablesCreatedBy(createSecFetchRateLimiterStorage({} as Pool));

    expect(created).toEqual([...secFetchRateLimiterTableNames()].sort());
    expect(ownedTableNames()).toEqual(expect.arrayContaining(created));
  });

  it("tracks the table names when the fetch budget is sharded by prefix columns", async () => {
    // The installed storage derives its table names from its prefix columns,
    // so a sharded budget renames them. Both sides read one configuration, so
    // this hypothetical config is what the reset would target as well.
    const sharded: RateLimiterStorageOptions = {
      prefixes: [
        { name: "host", type: "uuid" },
        { name: "queue", type: "number" },
      ],
      prefixValues: { host: "edgar", queue: 1 },
    };
    const created = await tablesCreatedBy(new PostgresRateLimiterStorage({} as Pool, sharded));

    expect(created).toEqual([
      "rate_limit_executions_host_queue",
      "rate_limit_next_available_host_queue",
    ]);
    expect([...rateLimiterStorageTableNames(sharded)].sort()).toEqual(created);
  });

  it("derives the reset's rate-limiter names instead of hardcoding them", () => {
    const source = readFileSync(new URL("./resetAllDatabases.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/"rate_limit_/);
    expect(rateLimiterStorageTableNames(SecFetchRateLimiterOptions)).toEqual(
      secFetchRateLimiterTableNames()
    );
  });
});
