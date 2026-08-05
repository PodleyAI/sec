/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, TaskAbortedError, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import type { FetchCompanyFactsTaskOutput } from "./FetchCompanyFactsTask";
import { fetchAndStoreCompanyFactsWithDeps } from "./fetchAndStoreCompanyFacts";
import { NoXbrlFactsError } from "./NoXbrlFactsError";

const ctx = {} as IExecuteContext;

function httpError(status: number): Error {
  const err = new Error(`Failed to fetch: ${status} oops`) as Error & { status: number };
  err.status = status;
  return err;
}

describe("fetchAndStoreCompanyFactsWithDeps", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  const getRow = async (cik: number) =>
    await globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN).get({ cik });

  it("records a plain success after fetch + store", async () => {
    let stored: FetchCompanyFactsTaskOutput | undefined;
    const result = await fetchAndStoreCompanyFactsWithDeps({ cik: 1, date: "2026-06-10" }, ctx, {
      fetchFacts: async () => ({ cik: 1, facts: [], date: "2026-06-10" }),
      storeFacts: async (fetched) => {
        stored = fetched;
      },
    });
    expect(result).toEqual({ success: true });
    expect(stored?.cik).toBe(1);
    const row = await getRow(1);
    expect(row?.success).toBe(true);
    expect(row?.reason_code).toBeNull();
    expect(row?.last_processed).toBe("2026-06-10");
  });

  it("records a 404 as a successful NO_XBRL_FACTS outcome without storing", async () => {
    let storeCalled = false;
    const result = await fetchAndStoreCompanyFactsWithDeps({ cik: 2, date: "2026-06-10" }, ctx, {
      fetchFacts: async () => {
        throw httpError(404);
      },
      storeFacts: async () => {
        storeCalled = true;
      },
    });
    expect(result).toEqual({ success: true });
    expect(storeCalled).toBe(false);
    const row = await getRow(2);
    expect(row?.success).toBe(true);
    expect(row?.reason_code).toBe("NO_XBRL_FACTS");
    expect(row?.attempts).toBe(0);
  });

  it("records a facts-less 200 body as a successful NO_XBRL_FACTS outcome without storing", async () => {
    let storeCalled = false;
    const result = await fetchAndStoreCompanyFactsWithDeps({ cik: 3521, date: "2026-06-10" }, ctx, {
      fetchFacts: async () => {
        throw new NoXbrlFactsError(3521);
      },
      storeFacts: async () => {
        storeCalled = true;
      },
    });
    expect(result).toEqual({ success: true });
    expect(storeCalled).toBe(false);
    const row = await getRow(3521);
    expect(row?.success).toBe(true);
    expect(row?.reason_code).toBe("NO_XBRL_FACTS");
    expect(row?.attempts).toBe(0);
  });

  it("records transient fetch failures as FETCH_ERROR with incrementing attempts", async () => {
    const deps = {
      fetchFacts: async (): Promise<FetchCompanyFactsTaskOutput> => {
        throw httpError(503);
      },
      storeFacts: async () => {},
    };
    await fetchAndStoreCompanyFactsWithDeps({ cik: 3, date: "2026-06-09" }, ctx, deps);
    await fetchAndStoreCompanyFactsWithDeps({ cik: 3, date: "2026-06-10" }, ctx, deps);
    const row = await getRow(3);
    expect(row?.success).toBe(false);
    expect(row?.reason_code).toBe("FETCH_ERROR");
    expect(row?.attempts).toBe(2);
    expect(row?.detail).toContain("503");
  });

  it("records storage failures as STORE_ERROR", async () => {
    await fetchAndStoreCompanyFactsWithDeps({ cik: 4, date: "2026-06-10" }, ctx, {
      fetchFacts: async () => ({ cik: 4, facts: [], date: "2026-06-10" }),
      storeFacts: async () => {
        throw new Error("disk full");
      },
    });
    const row = await getRow(4);
    expect(row?.success).toBe(false);
    expect(row?.reason_code).toBe("STORE_ERROR");
    expect(row?.detail).toBe("disk full");
  });

  it("rethrows aborts without recording an outcome", async () => {
    await expect(
      fetchAndStoreCompanyFactsWithDeps({ cik: 5, date: "2026-06-10" }, ctx, {
        fetchFacts: async () => {
          throw new TaskAbortedError();
        },
        storeFacts: async () => {},
      })
    ).rejects.toBeInstanceOf(TaskAbortedError);
    expect(await getRow(5)).toBeUndefined();
  });
});
