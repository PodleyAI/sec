/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  ADV_CUMULATIVE_SNAPSHOT,
  advArchiveFolder,
  advArchiveUrlForPeriod,
  latestAvailableAdvPeriod,
} from "./advArchive";

describe("advArchiveUrlForPeriod", () => {
  it("names the month's first and last day", () => {
    expect(advArchiveUrlForPeriod("2026-06")).toBe(
      "https://reports.adviserinfo.sec.gov/reports/foia/advFilingData/2026/ADV_Filing_Data_20260601_20260630.zip"
    );
  });

  it("gets February right in a leap year and out of one", () => {
    expect(advArchiveUrlForPeriod("2028-02")).toContain("20280201_20280229");
    expect(advArchiveUrlForPeriod("2026-02")).toContain("20260201_20260228");
  });

  it("refuses a period the monthly series never published", () => {
    expect(() => advArchiveUrlForPeriod("2024-12")).toThrow(/cumulative archive/);
  });

  it("refuses anything that is not a YYYY-MM month", () => {
    for (const bad of ["2026", "2026-13", "2026-00", "june", ""]) {
      expect(() => advArchiveUrlForPeriod(bad), bad).toThrow(/YYYY-MM/);
    }
  });
});

describe("advArchiveFolder", () => {
  it("gives every period a folder of its own", () => {
    expect(advArchiveFolder("2026-06")).toBe("adv/2026-06");
    expect(advArchiveFolder("2026-07")).toBe("adv/2026-07");
  });

  it("keeps the cumulative archive out of every monthly folder", () => {
    const cumulative = advArchiveFolder(ADV_CUMULATIVE_SNAPSHOT);
    expect(cumulative).toBe("adv/cumulative");
    // The whole point: no month can resolve to the folder holding 2011-2024,
    // which is what let one ingest read both and stamp them with one period.
    expect(advArchiveFolder("2025-01")).not.toBe(cumulative);
  });

  it("refuses a snapshot that names neither a month nor the cumulative archive", () => {
    for (const bad of ["2026", "2026-13", "adv", "", "../etc"]) {
      expect(() => advArchiveFolder(bad), bad).toThrow(/YYYY-MM/);
    }
  });
});

describe("latestAvailableAdvPeriod", () => {
  it("stays two months behind, since an archive publishes during the month after it covers", () => {
    expect(latestAvailableAdvPeriod(new Date("2026-06-15T00:00:00Z"))).toBe("2026-04");
  });

  it("crosses a year boundary", () => {
    expect(latestAvailableAdvPeriod(new Date("2026-01-10T00:00:00Z"))).toBe("2025-11");
  });
});
