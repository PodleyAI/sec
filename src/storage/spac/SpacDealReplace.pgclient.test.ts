/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_TYPE } from "../../config/tokens";
import type { SpacDeal } from "./SpacDealSchema";
import { recomputeSpacDeals } from "./SpacDealReplace";

const deal = (cik: number, deal_index: number, overrides: Partial<SpacDeal> = {}): SpacDeal => ({
  cik,
  deal_index,
  target_name: null,
  target_cik: null,
  announced_date: null,
  definitive_agreement_date: null,
  proxy_date: null,
  vote_date: null,
  pipe_amount: null,
  redemption_amount: null,
  redemption_shares: null,
  outcome: "pending",
  outcome_date: null,
  source_accession: null,
  created_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

/**
 * Mock client that records the SQL statements it sees, so we can assert
 * whether `BEGIN` / `COMMIT` were issued.
 */
interface MockClient {
  readonly queries: string[];
  query: (sql: string, _params?: unknown[]) => Promise<{ rows: never[] }>;
  release: () => void;
}

function makeMockClient(): MockClient & { released: boolean } {
  const queries: string[] = [];
  const obj = {
    queries,
    released: false,
    query: async (sql: string) => {
      queries.push(sql.trim().split(/\s+/, 1)[0].toUpperCase());
      return { rows: [] };
    },
    release: function () {
      this.released = true;
    },
  };
  return obj as MockClient & { released: boolean };
}

/**
 * Verifies the back-compat path: when `recomputeSpacDeals` is called WITHOUT
 * a caller-supplied `pgClient`, the Postgres branch still wraps its work in
 * its own BEGIN/COMMIT (and releases the client). Stubs `getPgPool` for the
 * duration of the test.
 */
describe("recomputeSpacDeals Postgres pool client handling", () => {
  let restorePool: (() => void) | undefined;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
  });

  afterEach(() => {
    restorePool?.();
    restorePool = undefined;
    globalServiceRegistry.registerInstance(
      SEC_DB_TYPE,
      "memory" as unknown as "sqlite" | "postgres"
    );
    resetDependencyInjectionsForTesting();
  });

  it("wraps its own transaction when no pgClient is provided (back-compat)", async () => {
    const client = makeMockClient();
    await mock.module("../../util/pg", () => ({
      getPgPool: () =>
        ({
          connect: async () => client,
        }) as unknown,
    }));
    restorePool = () => {
      mock.restore();
    };

    // Re-import after mocking so the SUT picks up the stub.
    const sut = await import("./SpacDealReplace");
    await sut.recomputeSpacDeals({
      // A real durable repo stub: the Postgres branch only reads dbType +
      // `isDurable()` (when present) and uses the client for SQL, so any
      // object passes here.
      dealRepo: {} as never,
      cik: 123,
      toDelete: [],
      toUpsert: [deal(123, 0, { outcome: "pending" })],
    });

    expect(client.queries[0]).toBe("BEGIN");
    expect(client.queries[client.queries.length - 1]).toBe("COMMIT");
    expect(client.released).toBe(true);
  });

  it("does NOT issue BEGIN/COMMIT/release on the caller-supplied client", async () => {
    const mock = makeMockClient();
    await recomputeSpacDeals({
      dealRepo: {} as never,
      cik: 123,
      toDelete: [],
      toUpsert: [deal(123, 0, { outcome: "pending" })],
      pgClient: mock as unknown as import("pg").PoolClient,
    });

    expect(mock.queries).not.toContain("BEGIN");
    expect(mock.queries).not.toContain("COMMIT");
    expect(mock.queries).not.toContain("ROLLBACK");
    expect(mock.released).toBe(false);
    // The INSERT still ran on the caller's client.
    expect(mock.queries).toContain("INSERT");
  });
});
