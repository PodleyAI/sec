/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DRY_RUN, SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import {
  DAILY_INDEX_CURSOR_ID,
  DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
} from "../../storage/processing/DailyIndexCursorSchema";
import { CatchUpDailyIndexTask } from "./CatchUpDailyIndexTask";
import * as dailyIndexDates from "./dailyIndexDates";
import { dailyIndexCacheRelPath, planIndexDays } from "./dailyIndexDates";
import * as dailyIndexPublication from "./dailyIndexPublication";
import { FetchDailyIndexTask } from "./FetchDailyIndexTask";

// A Tuesday. 2026-08-16 is the Sunday before it, 2026-08-15 the Saturday.
const TODAY = "2026-08-18";

let rawRoot: string | undefined;

function ctx(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: () => {},
    own: <T>(v: T): T => v,
    disown: () => {},
  } as unknown as IExecuteContext;
}

function httpError(status: number): Error {
  return Object.assign(new Error(`fetch failed: ${status} Not Found`), { status });
}

describe("CatchUpDailyIndexTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    vi.spyOn(dailyIndexDates, "todayEtYYYYdMMdDD").mockReturnValue(TODAY);
    // Default for the weekday probe: EDGAR has not published that day. Today's
    // index really has not been published for most of the day, and it keeps the
    // pre-existing cases (which 403 on TODAY, a Tuesday) reading as before.
    vi.spyOn(dailyIndexPublication, "dailyIndexWasPublished").mockResolvedValue(false);
    await globalServiceRegistry.get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN).put({
      id: DAILY_INDEX_CURSOR_ID,
      last_success: "2026-08-14",
    });
  });

  afterEach(() => {
    if (rawRoot) {
      rmSync(rawRoot, { recursive: true, force: true });
      rawRoot = undefined;
    }
    vi.restoreAllMocks();
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, false);
    resetDependencyInjectionsForTesting();
  });

  it("advances cursor through 403 on a completed Saturday (EDGAR's missing-day status) and finishes on 2xx days", async () => {
    const runSpy = vi
      .spyOn(FetchDailyIndexTask.prototype, "run")
      .mockImplementation(async (input) => {
        const date = input?.date;
        if (date === "2026-08-16" || date === TODAY) {
          throw httpError(403);
        }
        return { updateList: [[1018724, date!] as [number, string]] };
      });

    const result = await new CatchUpDailyIndexTask().execute({}, ctx());

    expect(runSpy).toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      skipped404: 1,
      todayFetched: false,
      lastSuccess: "2026-08-17",
    });
    expect(result.fetched).toBe(2);

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-17");

    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    expect((await cikRepo.get({ cik: 1018724 }))?.last_update).toBe("2026-08-17");
  });

  it("advances cursor through 404 on a completed Saturday and finishes on 2xx days", async () => {
    const runSpy = vi
      .spyOn(FetchDailyIndexTask.prototype, "run")
      .mockImplementation(async (input) => {
        const date = input?.date;
        if (date === "2026-08-16" || date === TODAY) {
          throw httpError(404);
        }
        return { updateList: [[1018724, date!] as [number, string]] };
      });

    const result = await new CatchUpDailyIndexTask().execute({}, ctx());

    expect(runSpy).toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      skipped404: 1,
      todayFetched: false,
      lastSuccess: "2026-08-17",
    });
    expect(result.fetched).toBe(2);

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-17");

    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    expect((await cikRepo.get({ cik: 1018724 }))?.last_update).toBe("2026-08-17");
  });

  it("rethrows on 5xx for a completed day and leaves cursor at the last success", async () => {
    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async (input) => {
      const date = input?.date;
      if (date === "2026-08-16") {
        throw httpError(500);
      }
      return { updateList: [] };
    });

    await expect(new CatchUpDailyIndexTask().execute({}, ctx())).rejects.toMatchObject({
      status: 500,
    });

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-15");
  });

  it("stores today's CIKs on 2xx without advancing last_success to today", async () => {
    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async (input) => {
      const date = input?.date ?? TODAY;
      return { updateList: [[320193, date] as [number, string]] };
    });

    const result = await new CatchUpDailyIndexTask().execute({}, ctx());

    expect(result).toMatchObject({
      success: true,
      todayFetched: true,
      lastSuccess: "2026-08-17",
    });

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-17");

    const cikRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    expect((await cikRepo.get({ cik: 320193 }))?.last_update).toBe(TODAY);
  });

  it("treats 403 today as success without changing the cursor", async () => {
    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async (input) => {
      const date = input?.date;
      if (date === TODAY) {
        throw httpError(403);
      }
      return { updateList: [] };
    });

    const result = await new CatchUpDailyIndexTask().execute({}, ctx());

    expect(result).toMatchObject({
      success: true,
      todayFetched: false,
      lastSuccess: "2026-08-17",
    });

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-17");
  });

  it("treats 404 today as success without changing the cursor", async () => {
    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async (input) => {
      const date = input?.date;
      if (date === TODAY) {
        throw httpError(404);
      }
      return { updateList: [] };
    });

    const result = await new CatchUpDailyIndexTask().execute({}, ctx());

    expect(result).toMatchObject({
      success: true,
      todayFetched: false,
      lastSuccess: "2026-08-17",
    });

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-17");
  });

  it("unlinks today's cache before fetch even though today is not in bypassCache", async () => {
    const plan = planIndexDays({
      lastSuccess: "2026-08-14",
      fromOverride: undefined,
      seed: undefined,
      today: TODAY,
      lookback: 3,
    });
    expect(plan.bypassCache).not.toContain(TODAY);

    rawRoot = mkdtempSync(path.join(tmpdir(), "sec-catchup-index-"));
    globalServiceRegistry.registerInstance(SEC_RAW_DATA_FOLDER, rawRoot);
    const todayCachePath = path.join(rawRoot, dailyIndexCacheRelPath(TODAY));
    mkdirSync(path.dirname(todayCachePath), { recursive: true });
    writeFileSync(todayCachePath, "stale");

    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockResolvedValue({ updateList: [] });

    await new CatchUpDailyIndexTask().execute({}, ctx());

    await expect(access(todayCachePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not write the cursor in dry-run mode", async () => {
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    const runSpy = vi.spyOn(FetchDailyIndexTask.prototype, "run");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await new CatchUpDailyIndexTask().execute({}, ctx());

    expect(runSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      fetched: 0,
      skipped404: 0,
      todayFetched: false,
      lastSuccess: "2026-08-14",
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Would fetch completed"));

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-14");
  });

  it("seeds from max cik_last_update when the cursor is empty", async () => {
    await globalServiceRegistry.get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN).delete({
      id: DAILY_INDEX_CURSOR_ID,
    });
    await globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN).put({
      cik: 1018724,
      last_update: "2026-08-10",
    });

    const runSpy = vi.spyOn(FetchDailyIndexTask.prototype, "run").mockResolvedValue({
      updateList: [],
    });

    await new CatchUpDailyIndexTask().execute({ lookback: 3 }, ctx());

    const fetchedDates = runSpy.mock.calls
      .map((call) => call[0]?.date)
      .filter((date): date is string => typeof date === "string");
    expect(fetchedDates).not.toContain("2026-08-10");
    expect(fetchedDates).toContain("2026-08-11");
    expect(fetchedDates).toContain("2026-08-17");
    expect(fetchedDates).toContain(TODAY);

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-17");
  });
  // --- 403 is ambiguous: unpublished day, or a client EDGAR is refusing? ---
  //
  // Accepting every 403 as "unpublished" walks `last_success` over every real
  // trading day in the lookback and reports `success: true`, and nothing ever
  // goes back for those days. These four pin the discrimination.

  it("does not probe a weekend 403 — EDGAR never published one", async () => {
    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async (input) => {
      const date = input?.date;
      // The Saturday and the Sunday of the lookback window.
      if (date === "2026-08-15" || date === "2026-08-16") throw httpError(403);
      return { updateList: [] };
    });
    const probe = vi.mocked(dailyIndexPublication.dailyIndexWasPublished);
    probe.mockClear();

    const result = await new CatchUpDailyIndexTask().execute({ lookback: 4 }, ctx());

    expect(result.success).toBe(true);
    expect(result.skipped404).toBe(2);
    // Only TODAY (a Tuesday) reaches the probe; neither weekend day does.
    for (const call of probe.mock.calls) {
      expect(call[0]).toBe(TODAY);
    }
  });

  it("throws on a weekday 403 the quarter listing says WAS published, leaving the cursor put", async () => {
    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async (input) => {
      // A blocked client: every day 403s, including real trading days.
      throw httpError(403);
    });
    vi.mocked(dailyIndexPublication.dailyIndexWasPublished).mockImplementation(
      async (date) => date !== TODAY
    );

    await expect(new CatchUpDailyIndexTask().execute({}, ctx())).rejects.toThrow(
      /being refused|Refusing to advance/
    );

    // The Saturday and Sunday are skipped without a probe and do advance the
    // cursor — EDGAR published nothing on them, so nothing is lost. It stops
    // dead at the Monday, which is the day whose filings would have been.
    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-16");
  });

  it("skips a weekday 403 the quarter listing does not name — a market holiday", async () => {
    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async (input) => {
      const date = input?.date;
      if (date === "2026-08-17" || date === TODAY) throw httpError(403);
      return { updateList: [] };
    });
    vi.mocked(dailyIndexPublication.dailyIndexWasPublished).mockResolvedValue(false);

    const result = await new CatchUpDailyIndexTask().execute({}, ctx());

    expect(result.success).toBe(true);
    expect(result.lastSuccess).toBe("2026-08-17");
    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-17");
  });

  it("throws when the probe itself cannot answer, rather than assuming unpublished", async () => {
    vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async () => {
      throw httpError(403);
    });
    vi.mocked(dailyIndexPublication.dailyIndexWasPublished).mockRejectedValue(
      new Error("listing fetch failed: 403")
    );

    await expect(new CatchUpDailyIndexTask().execute({}, ctx())).rejects.toThrow(
      /could not be read either/
    );

    // Stops at the last weekend day, before the first weekday it could not
    // classify — an unanswerable probe never advances past a trading day.
    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-16");
  });
});
