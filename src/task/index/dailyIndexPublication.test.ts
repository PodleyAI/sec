/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IExecuteContext } from "workglow";
import { SecFetchTask } from "../fetch/SecFetchTask";
import {
  dailyIndexWasPublished,
  isWeekendDate,
  quarterListingUrl,
  resetDailyIndexListingCacheForTesting,
} from "./dailyIndexPublication";

function ctx(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: () => {},
    own: <T>(v: T): T => v,
    disown: () => {},
  } as unknown as IExecuteContext;
}

/** The shape EDGAR's `.../daily-index/<year>/QTR<n>/index.json` really returns. */
function listing(dates: readonly string[]): string {
  return JSON.stringify({
    directory: {
      item: [
        { name: "index.json", type: "file" },
        ...dates.flatMap((d) => [
          { name: `company.${d}.idx`, type: "file" },
          { name: `master.${d}.idx`, type: "file" },
        ]),
      ],
    },
  });
}

describe("isWeekendDate", () => {
  it("separates the weekend from the trading week", () => {
    // 2026-08-15 Sat, 08-16 Sun, 08-17 Mon .. 08-21 Fri.
    expect(isWeekendDate("2026-08-15")).toBe(true);
    expect(isWeekendDate("2026-08-16")).toBe(true);
    for (const d of ["2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21"]) {
      expect(isWeekendDate(d)).toBe(false);
    }
  });

  it("reads the date as a calendar date, not a local instant", () => {
    // A date-only value must not shift a day under any host time zone; these
    // straddle a DST boundary in America/New_York.
    expect(isWeekendDate("2026-03-07")).toBe(true);
    expect(isWeekendDate("2026-03-09")).toBe(false);
    expect(isWeekendDate("2026-11-07")).toBe(true);
    expect(isWeekendDate("2026-11-09")).toBe(false);
  });
});

describe("dailyIndexWasPublished", () => {
  beforeEach(() => {
    resetDailyIndexListingCacheForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetDailyIndexListingCacheForTesting();
  });

  it("reports a day the quarter listing names, and one it does not", async () => {
    vi.spyOn(SecFetchTask.prototype, "run").mockResolvedValue({
      text: listing(["20260701", "20260702", "20260706"]),
    } as never);

    // Friday 2026-07-03 is Independence Day observed: a real weekday 403.
    expect(await dailyIndexWasPublished("2026-07-02", ctx())).toBe(true);
    expect(await dailyIndexWasPublished("2026-07-03", ctx())).toBe(false);
  });

  it("addresses each date's own quarter listing", () => {
    expect(quarterListingUrl(2026, 1)).toBe(
      "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR1/index.json"
    );
    expect(quarterListingUrl(2026, 4)).toBe(
      "https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/index.json"
    );
  });

  it("asks a different listing per quarter", async () => {
    const runSpy = vi
      .spyOn(SecFetchTask.prototype, "run")
      .mockResolvedValue({ text: listing([]) } as never);

    await dailyIndexWasPublished("2026-02-17", ctx());
    await dailyIndexWasPublished("2026-11-26", ctx());

    expect(runSpy).toHaveBeenCalledTimes(2);
  });

  it("fetches one listing per quarter, however many days ask", async () => {
    const runSpy = vi
      .spyOn(SecFetchTask.prototype, "run")
      .mockResolvedValue({ text: listing(["20260706"]) } as never);

    // A catch-up crossing several holidays in one quarter must not re-fetch.
    await Promise.all([
      dailyIndexWasPublished("2026-07-03", ctx()),
      dailyIndexWasPublished("2026-08-14", ctx()),
      dailyIndexWasPublished("2026-09-07", ctx()),
    ]);

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed probe instead of answering 'unpublished'", async () => {
    vi.spyOn(SecFetchTask.prototype, "run").mockRejectedValue(
      Object.assign(new Error("fetch failed: 403"), { status: 403 })
    );

    await expect(dailyIndexWasPublished("2026-07-03", ctx())).rejects.toThrow(/403/);
  });

  it("does not cache a failed probe — the next day asks again", async () => {
    const runSpy = vi
      .spyOn(SecFetchTask.prototype, "run")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ text: listing(["20260703"]) } as never);

    await expect(dailyIndexWasPublished("2026-07-03", ctx())).rejects.toThrow(/boom/);
    expect(await dailyIndexWasPublished("2026-07-03", ctx())).toBe(true);
    expect(runSpy).toHaveBeenCalledTimes(2);
  });

  it("throws on a body that is not the listing, rather than reading it as empty", async () => {
    // An EDGAR error page or a truncated body must not read as "no index for
    // any day", which would skip every day in the quarter.
    vi.spyOn(SecFetchTask.prototype, "run").mockResolvedValue({
      text: "<html>Your Request Originates from an Undeclared Automated Tool</html>",
    } as never);

    await expect(dailyIndexWasPublished("2026-07-03", ctx())).rejects.toThrow();
  });
});
