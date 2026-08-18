/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { access } from "node:fs/promises";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { SEC_DRY_RUN, SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import {
  DAILY_INDEX_CURSOR_ID,
  DAILY_INDEX_CURSOR_REPOSITORY_TOKEN,
} from "../../storage/processing/DailyIndexCursorSchema";
import * as dailyIndexDates from "./dailyIndexDates";
import { dailyIndexCacheRelPath, planIndexDays } from "./dailyIndexDates";
import { CatchUpDailyIndexTask } from "./CatchUpDailyIndexTask";
import { FetchDailyIndexTask } from "./FetchDailyIndexTask";

const TODAY = "2026-08-18";

let rawRoot: string | undefined;

function ctx(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: () => {},
    own: <T>(v: T): T => v,
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

  it("advances cursor through 404 on a completed Saturday and finishes on 2xx days", async () => {
    const runSpy = vi.spyOn(FetchDailyIndexTask.prototype, "run").mockImplementation(async (input) => {
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
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Would fetch completed")
    );

    const cursor = await globalServiceRegistry
      .get(DAILY_INDEX_CURSOR_REPOSITORY_TOKEN)
      .get({ id: DAILY_INDEX_CURSOR_ID });
    expect(cursor?.last_success).toBe("2026-08-14");
  });
});
