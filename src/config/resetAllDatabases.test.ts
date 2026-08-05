/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Pool, RateLimiterStorageOptions } from "workglow";
import { globalServiceRegistry, PostgresRateLimiterStorage } from "workglow";
import { createSecFetchRateLimiterStorage } from "../task/fetch/SecJobQueue";
import {
  rateLimiterStorageTableNames,
  SecFetchRateLimiterOptions,
  secFetchRateLimiterTableNames,
} from "../task/fetch/secFetchRateLimiterConfig";
import { ownedTableNames, resetAllDatabases } from "./resetAllDatabases";
import { SEC_STORAGE_REGISTRY } from "./storageRegistry";
import { resetDependencyInjectionsForTesting } from "./TestingDI";

/**
 * Drift guard for `sec db reset --confirm`. The SQL backends drop the tables in
 * the ownership registry, but the in-memory fallback still truncates a
 * hand-maintained list of repository tokens; a table whose `deleteAll()` is
 * forgotten there survives a "reset" fully populated (orphan rows + dangling
 * cross-tier references).
 *
 * The check runs the real reset against in-memory repositories and asserts each
 * registered storage was actually truncated, so it fails on a token the list
 * never reaches — not merely on one whose name is absent from the source text.
 */
describe("resetAllDatabases token coverage", () => {
  it("truncates every storage in the registry", async () => {
    resetDependencyInjectionsForTesting();

    const truncations = SEC_STORAGE_REGISTRY.map((definition) => ({
      id: definition.token.id,
      spy: vi.spyOn(globalServiceRegistry.get(definition.token), "deleteAll"),
    }));

    // No SEC_DB_TYPE is bound after the reset above, so this takes the
    // in-memory fallback — the arm that truncates token by token.
    await resetAllDatabases();

    const missing = truncations
      .filter(({ spy }) => spy.mock.calls.length === 0)
      .map(({ id }) => id)
      .sort();
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
