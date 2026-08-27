/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import type { Factoid } from "../../sec/facts/CompanyFacts";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { coalesceFy, StoreCompanyFactsTask } from "./StoreCompanyFactsTask";

function ctx(): IExecuteContext {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    updateProgress: async () => {},
    own: <T>(v: T): T => v,
    registry: {
      has: () => false,
      get: () => {
        throw new Error("not registered");
      },
    } as any,
    resourceScope: {
      register: (_k: string, _fn: () => Promise<void>) => {},
      dispose: async () => {},
    } as any,
  } as unknown as IExecuteContext;
}

/**
 * Base row shared across DEF-14A pay-vs-performance style regression cases.
 * Every non-period column is identical so distinct `end_date`s are the ONLY
 * thing that keep the two facts apart in the primary key — which is exactly
 * where the fy sentinel collapse used to bite.
 */
function payVsPerfBase(overrides: Partial<Factoid>): Factoid {
  return {
    cik: 1018724,
    grouping: "cef",
    name: "PeoPeoTotalCompensationAmount",
    filed_date: "2026-04-15",
    form: "DEF 14A",
    val_unit: "USD",
    frame: null,
    accession_number: "0001018724-26-000042",
    start_date: null,
    end_date: "2024-12-31",
    val: 12345678,
    fy: null,
    fp: null,
    ...overrides,
  };
}

describe("coalesceFy", () => {
  it("returns fy verbatim when set", () => {
    expect(coalesceFy(2024, "2024-12-31")).toBe(2024);
  });

  it("derives the year from end_date when fy is null", () => {
    expect(coalesceFy(null, "2024-12-31")).toBe(2024);
    expect(coalesceFy(null, "2023-06-30")).toBe(2023);
  });

  it("falls back to 0 when both fy and end_date are null", () => {
    expect(coalesceFy(null, null)).toBe(0);
  });

  it("falls back to 0 when end_date's leading four chars aren't a finite number", () => {
    expect(coalesceFy(null, "----12-31")).toBe(0);
    expect(coalesceFy(null, "")).toBe(0);
  });
});

describe("StoreCompanyFactsTask fy/fp sentinel handling", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("preserves two period-agnostic pay-vs-performance rows differing only in end_date", async () => {
    // Both rows have fy=null and fp=null — EDGAR's real shape for a
    // DEF-14A pay-vs-performance figure — and every PK column is identical
    // except end_date. With the pre-fix "null -> 0" sentinel, both rows
    // squashed to the same primary key and only the last write survived.
    const facts: Factoid[] = [
      payVsPerfBase({ end_date: "2023-12-31", val: 5_000_000 }),
      payVsPerfBase({ end_date: "2024-12-31", val: 8_000_000 }),
    ];
    await new StoreCompanyFactsTask().execute({ cik: 1018724, facts, date: undefined }, ctx());
    const repo = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
    const rows =
      (await repo.query({
        cik: 1018724,
        grouping: "cef",
        name: "PeoPeoTotalCompensationAmount",
      })) ?? [];
    expect(rows).toHaveLength(2);
    const years = rows.map((r) => r.fy).sort();
    expect(years).toEqual([2023, 2024]);
  });

  it("coalesces fy to 0 when both fy and end_date are null", async () => {
    const facts: Factoid[] = [payVsPerfBase({ end_date: null, val: 1 })];
    await new StoreCompanyFactsTask().execute({ cik: 1018724, facts, date: undefined }, ctx());
    const repo = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
    const rows =
      (await repo.query({
        cik: 1018724,
        grouping: "cef",
        name: "PeoPeoTotalCompensationAmount",
      })) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].fy).toBe(0);
    expect(rows[0].fp).toBe("");
  });

  it("writes fy=2024, fp=Q1 verbatim when reported", async () => {
    const facts: Factoid[] = [payVsPerfBase({ fy: 2024, fp: "Q1", val: 42 })];
    await new StoreCompanyFactsTask().execute({ cik: 1018724, facts, date: undefined }, ctx());
    const repo = globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN);
    const rows =
      (await repo.query({
        cik: 1018724,
        grouping: "cef",
        name: "PeoPeoTotalCompensationAmount",
      })) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0].fy).toBe(2024);
    expect(rows[0].fp).toBe("Q1");
  });
});
