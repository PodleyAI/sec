/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  classifyRegACurrentReport,
  isSubstantiveRegACurrentReport,
  REGA_CURRENT_REPORT_ITEMS,
} from "./regACurrentReportItems";

describe("classifyRegACurrentReport", () => {
  it("maps each Form 1-U item to its event", () => {
    expect(classifyRegACurrentReport("1")).toBe("fundamental_change");
    expect(classifyRegACurrentReport("2")).toBe("bankruptcy");
    expect(classifyRegACurrentReport("3")).toBe("rights_modification");
    expect(classifyRegACurrentReport("4")).toBe("auditor_change");
    expect(classifyRegACurrentReport("5")).toBe("non_reliance");
    expect(classifyRegACurrentReport("6")).toBe("control_change");
    expect(classifyRegACurrentReport("7")).toBe("officer_departure");
    expect(classifyRegACurrentReport("8")).toBe("unregistered_sales");
  });

  it("flattens both Other Events sub-codes", () => {
    // 9.1 alone is 10,532 of 11,600 filings — the dominant case, and genuinely
    // "other" rather than a classification failure.
    expect(classifyRegACurrentReport("9.1")).toBe("other");
    expect(classifyRegACurrentReport("9.2")).toBe("other");
  });

  it("picks the most significant item, not the first listed", () => {
    // EDGAR orders items numerically, so "first" would classify `1,9.1` on
    // fundamental_change by luck and `2,1` on bankruptcy by luck. Ranking makes
    // both deliberate — and order of the input must not matter.
    expect(classifyRegACurrentReport("1,9.1")).toBe("fundamental_change");
    expect(classifyRegACurrentReport("9.1,1")).toBe("fundamental_change");
    expect(classifyRegACurrentReport("1,2")).toBe("bankruptcy");
    expect(classifyRegACurrentReport("2,1")).toBe("bankruptcy");
    expect(classifyRegACurrentReport("7,8,6")).toBe("control_change");
  });

  it("falls back to other rather than throwing on an unknown code", () => {
    // A future item number must not stop the filing being recorded: the row's
    // DATE is its main value, and refusing it would reintroduce the blind spot
    // the table exists to close. The raw codes are stored verbatim alongside.
    expect(classifyRegACurrentReport("42")).toBe("other");
    expect(classifyRegACurrentReport("42,9.1")).toBe("other");
    expect(classifyRegACurrentReport("")).toBe("other");
    expect(classifyRegACurrentReport(null)).toBe("other");
    expect(classifyRegACurrentReport(undefined)).toBe("other");
  });

  it("still finds a known item beside an unknown one", () => {
    expect(classifyRegACurrentReport("42,2")).toBe("bankruptcy");
  });

  it("tolerates whitespace in the joined list", () => {
    expect(classifyRegACurrentReport(" 1 , 9.1 ")).toBe("fundamental_change");
  });

  it("covers every item code observed in production", () => {
    // The live distribution across 11,600 filings. If EDGAR introduces a code we
    // do not know, this is where it should be noticed rather than in a sweep.
    for (const code of ["9.1", "1", "4", "7", "3", "8", "9.2", "6", "5", "2"]) {
      expect(
        REGA_CURRENT_REPORT_ITEMS[code as keyof typeof REGA_CURRENT_REPORT_ITEMS],
        `item ${code} is unmapped`
      ).toBeDefined();
    }
  });
});

describe("isSubstantiveRegACurrentReport", () => {
  it("separates the ~1,000 reportable events from the 10,532 other-events", () => {
    expect(isSubstantiveRegACurrentReport("bankruptcy")).toBe(true);
    expect(isSubstantiveRegACurrentReport("control_change")).toBe(true);
    expect(isSubstantiveRegACurrentReport("other")).toBe(false);
  });
});
