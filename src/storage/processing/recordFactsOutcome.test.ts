/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "./ProcessedFactsSchema";
import { recordFactsOutcome } from "./recordFactsOutcome";

describe("recordFactsOutcome", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  const getRow = async (cik: number) =>
    await globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN).get({ cik });

  it("records a success with no reason and zero attempts", async () => {
    await recordFactsOutcome({
      cik: 1,
      date: "2026-06-10",
      success: true,
      reason_code: null,
      detail: null,
    });
    const row = await getRow(1);
    expect(row?.success).toBe(true);
    expect(row?.last_processed).toBe("2026-06-10");
    expect(row?.reason_code).toBeNull();
    expect(row?.detail).toBeNull();
    expect(row?.attempts).toBe(0);
  });

  it("records NO_XBRL_FACTS as a successful terminal outcome", async () => {
    await recordFactsOutcome({
      cik: 2,
      date: "2026-06-10",
      success: true,
      reason_code: "NO_XBRL_FACTS",
      detail: null,
    });
    const row = await getRow(2);
    expect(row?.success).toBe(true);
    expect(row?.reason_code).toBe("NO_XBRL_FACTS");
    expect(row?.attempts).toBe(0);
  });

  it("increments attempts across consecutive failures and refreshes the reason", async () => {
    await recordFactsOutcome({
      cik: 3,
      date: "2026-06-09",
      success: false,
      reason_code: "FETCH_ERROR",
      detail: "503 Service Unavailable",
    });
    await recordFactsOutcome({
      cik: 3,
      date: "2026-06-10",
      success: false,
      reason_code: "PARSE_ERROR",
      detail: "missing facts object",
    });
    const row = await getRow(3);
    expect(row?.success).toBe(false);
    expect(row?.attempts).toBe(2);
    expect(row?.reason_code).toBe("PARSE_ERROR");
    expect(row?.detail).toBe("missing facts object");
    expect(row?.last_processed).toBe("2026-06-10");
  });

  it("resets attempts and clears the reason on success after failure", async () => {
    await recordFactsOutcome({
      cik: 4,
      date: "2026-06-09",
      success: false,
      reason_code: "FETCH_ERROR",
      detail: "boom",
    });
    await recordFactsOutcome({
      cik: 4,
      date: "2026-06-10",
      success: true,
      reason_code: null,
      detail: null,
    });
    const row = await getRow(4);
    expect(row?.success).toBe(true);
    expect(row?.attempts).toBe(0);
    expect(row?.reason_code).toBeNull();
    expect(row?.detail).toBeNull();
  });

  it("truncates oversized detail", async () => {
    await recordFactsOutcome({
      cik: 5,
      date: "2026-06-10",
      success: false,
      reason_code: "STORE_ERROR",
      detail: "x".repeat(5000),
    });
    const row = await getRow(5);
    expect(row?.detail?.length).toBe(1024);
  });
});
