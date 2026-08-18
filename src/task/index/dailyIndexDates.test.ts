/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  dailyIndexCacheRelPath,
  planIndexDays,
  todayEtYYYYdMMdDD,
} from "./dailyIndexDates";

const TODAY = "2026-08-18";

describe("todayEtYYYYdMMdDD", () => {
  it("returns ET calendar date at midnight-ish UTC on Tuesday", () => {
    expect(todayEtYYYYdMMdDD(new Date("2026-08-18T04:00:00Z"))).toBe("2026-08-18");
  });

  it("returns previous ET date when UTC is still Monday evening", () => {
    expect(todayEtYYYYdMMdDD(new Date("2026-08-18T03:00:00Z"))).toBe("2026-08-17");
  });
});

describe("planIndexDays", () => {
  it("uses lookback only when cursor is current through yesterday", () => {
    const plan = planIndexDays({
      lastSuccess: "2026-08-17",
      fromOverride: undefined,
      seed: undefined,
      today: TODAY,
      lookback: 3,
    });
    expect(plan.today).toBe(TODAY);
    expect(plan.completed).toEqual(["2026-08-15", "2026-08-16", "2026-08-17"]);
    expect(plan.bypassCache).toEqual(["2026-08-15", "2026-08-16", "2026-08-17"]);
  });

  it("catch-up from seed through yesterday, union lookback", () => {
    const plan = planIndexDays({
      lastSuccess: undefined,
      fromOverride: undefined,
      seed: "2026-08-10",
      today: TODAY,
      lookback: 3,
    });
    expect(plan.completed).toEqual([
      "2026-08-11",
      "2026-08-12",
      "2026-08-13",
      "2026-08-14",
      "2026-08-15",
      "2026-08-16",
      "2026-08-17",
    ]);
    expect(plan.bypassCache).toEqual(["2026-08-15", "2026-08-16", "2026-08-17"]);
  });

  it("uses lookback only when cursor and seed are empty", () => {
    const plan = planIndexDays({
      lastSuccess: undefined,
      fromOverride: undefined,
      seed: undefined,
      today: TODAY,
      lookback: 3,
    });
    expect(plan.today).toBe(TODAY);
    expect(plan.completed).toEqual(["2026-08-15", "2026-08-16", "2026-08-17"]);
    expect(plan.bypassCache).toEqual(["2026-08-15", "2026-08-16", "2026-08-17"]);
  });

  it("honors --from over cursor, union lookback", () => {
    const plan = planIndexDays({
      lastSuccess: "2026-08-01",
      fromOverride: "2026-08-16",
      seed: undefined,
      today: TODAY,
      lookback: 3,
    });
    expect(plan.completed).toEqual(["2026-08-15", "2026-08-16", "2026-08-17"]);
    expect(plan.bypassCache).toEqual(["2026-08-15", "2026-08-16", "2026-08-17"]);
  });
});

describe("dailyIndexCacheRelPath", () => {
  it("matches SecFetchDailyIndexTask cache layout", () => {
    expect(dailyIndexCacheRelPath("2026-08-17")).toBe(
      "daily-index/2026/2026-08-17.master.idx"
    );
  });
});
