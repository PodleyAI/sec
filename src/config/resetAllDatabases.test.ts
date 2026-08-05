/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { SEC_DB_TYPE } from "./tokens";

const SCHEMA = "sec_reset_test";
const LEDGER = "_storage_migrations";
const RATE_LIMITER_COMPONENT = "rate-limiter:postgres:rate_limit_executions";

/**
 * Records every statement the Postgres reset issues against a stand-in client,
 * so the scoping can be asserted without a live database. `presentTables` is
 * what the `information_schema` probe reports back.
 */
const pg = vi.hoisted(() => {
  const recorded: { sql: string; params: unknown[] | undefined }[] = [];
  let presentTables: readonly string[] = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      recorded.push({ sql, params });
      if (sql.includes("information_schema.tables")) {
        return { rows: presentTables.map((table_name) => ({ table_name })) };
      }
      if (sql.includes("current_schema()")) return { rows: [{ name: SCHEMA }] };
      return { rows: [] };
    },
    release() {},
  };
  return {
    recorded,
    setPresentTables(tables: readonly string[]) {
      presentTables = tables;
    },
    pool: { connect: async () => client },
  };
});

vi.mock("../util/pg", () => ({
  getPgPool: () => pg.pool,
  closePgPool: async () => {},
}));

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

/**
 * `_storage_migrations` is `@workglow/storage`'s applied-version ledger, shared
 * by every package built on it under one fixed table name — so a reset whose
 * whole point is "drop only what sec owns" must not drop it. It must still
 * clear sec's OWN rows, though: the runner skips a `(component, version)` it
 * finds recorded, so a row outliving the table it created would stop the next
 * `db setup` from recreating it. Both halves are pinned here.
 */
describe("resetAllDatabases migration-ledger scoping", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    pg.recorded.length = 0;
    pg.setPresentTables([LEDGER, "rate_limit_executions", "rate_limit_next_available"]);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const statements = (): string[] => pg.recorded.map((q) => q.sql);

  it("never drops the shared ledger in a scoped reset", async () => {
    await resetAllDatabases();

    expect(statements().filter((sql) => sql.includes(LEDGER) && sql.includes("DROP"))).toEqual([]);
    expect(statements().some((sql) => sql.includes("DROP SCHEMA"))).toBe(false);
  });

  it("reports the ledger among the tables it left standing", async () => {
    await resetAllDatabases();

    const warnings = warn.mock.calls.map((args) => String(args[0])).join("\n");
    expect(warnings).toContain("does not own");
    expect(warnings).toContain(LEDGER);
  });

  it("clears only the ledger rows sec's own setup recorded", async () => {
    await resetAllDatabases();

    // The tables those rows describe ARE dropped, so ledger and tables stay in
    // step — that is what makes the scoped delete mandatory rather than tidy.
    expect(statements()).toContain(`DROP TABLE IF EXISTS "${SCHEMA}"."rate_limit_executions"`);

    const deletes = pg.recorded.filter((q) => q.sql.startsWith("DELETE FROM"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.sql).toBe(`DELETE FROM "${SCHEMA}"."${LEDGER}" WHERE component = ANY($1)`);
    expect(deletes[0]?.params).toEqual([[RATE_LIMITER_COMPONENT]]);
  });

  it("skips the delete when the schema carries no ledger at all", async () => {
    pg.setPresentTables(["rate_limit_executions"]);

    await resetAllDatabases();

    // `DELETE FROM` a missing table would abort the transaction the drops ran in.
    expect(pg.recorded.some((q) => q.sql.startsWith("DELETE FROM"))).toBe(false);
    expect(statements()).toContain("COMMIT");
  });

  it("still removes the ledger under --drop-schema", async () => {
    await resetAllDatabases({ dropSchema: true });

    // The documented destroy-everything escape hatch: the ledger goes with the
    // schema, so there is nothing left to scope a delete against.
    expect(statements()).toContain(`DROP SCHEMA "${SCHEMA}" CASCADE`);
    expect(statements()).toContain(`CREATE SCHEMA "${SCHEMA}"`);
    expect(pg.recorded.some((q) => q.sql.startsWith("DELETE FROM"))).toBe(false);
    expect(statements().some((sql) => sql.includes("DROP TABLE"))).toBe(false);
  });
});
