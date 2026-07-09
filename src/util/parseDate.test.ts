/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseDate, secDate } from "./parseDate";

describe("parseDate", () => {
  it("parses yyyy-MM-dd", () => {
    expect(parseDate("2023-04-05")).toEqual({ year: 2023, month: "04", day: "05" });
  });

  it("parses yyyy/MM/dd", () => {
    expect(parseDate("2023/04/05")).toEqual({ year: 2023, month: "04", day: "05" });
  });

  it("parses MM/dd/yyyy", () => {
    expect(parseDate("04/05/2023")).toEqual({ year: 2023, month: "04", day: "05" });
  });

  it("parses the compact yyyyMMdd form (EDGAR index filenames)", () => {
    // Regression: the old regex/branch scrambled this to {year:5, month:'2023'}.
    expect(parseDate("20230405")).toEqual({ year: 2023, month: "04", day: "05" });
    expect(parseDate("20231231")).toEqual({ year: 2023, month: "12", day: "31" });
  });

  it("throws on an unrecognised format", () => {
    expect(() => parseDate("not-a-date")).toThrow("Invalid date format");
  });

  it("rejects out-of-range months and days the digit-count regexes admit", () => {
    // The regexes only constrain digit counts, so these would otherwise parse to
    // bogus { month: '13' } / { day: '45' } instead of being rejected.
    expect(() => parseDate("20251301")).toThrow("Invalid date format"); // month 13
    expect(() => parseDate("20250045")).toThrow("Invalid date format"); // day 45 (and month 00)
    expect(() => parseDate("2025-00-10")).toThrow("Invalid date format"); // month 00
    expect(() => parseDate("2025-12-32")).toThrow("Invalid date format"); // day 32
    expect(() => parseDate("13/05/2025")).toThrow("Invalid date format"); // month 13 (MM/dd/yyyy)
  });

  it("accepts boundary months and days", () => {
    expect(parseDate("20250101")).toEqual({ year: 2025, month: "01", day: "01" });
    expect(parseDate("20251231")).toEqual({ year: 2025, month: "12", day: "31" });
  });

  it("accepts calendar-valid dates in years 0000-0099 (no century-remap false reject)", () => {
    // Date.UTC maps years 0-99 to 1900-1999; the probe restores the literal
    // year before comparing, so these valid dates are NOT wrongly rejected.
    expect(parseDate("0099-01-01")).toEqual({ year: 99, month: "01", day: "01" });
    expect(parseDate("0001-12-31")).toEqual({ year: 1, month: "12", day: "31" });
    // A calendar-invalid date in that century range is still rejected.
    expect(() => parseDate("0099-02-30")).toThrow(/Invalid calendar date/);
  });

  it("rejects Feb 30 in any year", () => {
    // Without the calendar probe, `new Date("2025-02-30")` silently rolls to
    // March 2 — corrupting ChangeLog / spac_history point-in-time semantics.
    expect(() => parseDate("2025-02-30")).toThrow(/Invalid calendar date/);
    expect(() => parseDate("2024-02-30")).toThrow(/Invalid calendar date/);
  });

  it("rejects Feb 29 in a non-leap year but accepts it in a leap year", () => {
    expect(() => parseDate("2025-02-29")).toThrow(/Invalid calendar date/);
    expect(() => parseDate("2023-02-29")).toThrow(/Invalid calendar date/);
    // 1900 is not a leap year (divisible by 100, not by 400).
    expect(() => parseDate("1900-02-29")).toThrow(/Invalid calendar date/);
    // 2024 is a leap year; 2000 is a leap year (divisible by 400).
    expect(parseDate("2024-02-29")).toEqual({ year: 2024, month: "02", day: "29" });
    expect(parseDate("2000-02-29")).toEqual({ year: 2000, month: "02", day: "29" });
  });

  it.each([
    ["2025-04-31", 4],
    ["2025-06-31", 6],
    ["2025-09-31", 9],
    ["2025-11-31", 11],
  ])("rejects the impossible 31st of a 30-day month (%s)", (input) => {
    expect(() => parseDate(input)).toThrow(/Invalid calendar date/);
  });

  it.each([
    ["2025-00-10"], // month 0
    ["2025-13-10"], // month 13
    ["2025-01-00"], // day 0
    ["2025-01-32"], // day 32
  ])("rejects out-of-range month/day (%s)", (input) => {
    expect(() => parseDate(input)).toThrow("Invalid date format");
  });

  it("accepts all four supported formats for a valid date", () => {
    // Regression fence: the calendar probe must not reject any of the
    // recognised shapes for a well-formed real date.
    const expected = { year: 2024, month: "02", day: "29" };
    expect(parseDate("2024-02-29")).toEqual(expected);
    expect(parseDate("2024/02/29")).toEqual(expected);
    expect(parseDate("02/29/2024")).toEqual(expected);
    expect(parseDate("02-29-2024")).toEqual(expected);
    expect(parseDate("20240229")).toEqual(expected);
  });
});

describe("secDate", () => {
  it("round-trips the compact form to YYYY-MM-DD", () => {
    expect(secDate("20230405")).toBe("2023-04-05");
  });

  it("formats a Date", () => {
    // Local-time constructor + secDate's local getters => timezone-independent.
    expect(secDate(new Date(2023, 3, 5))).toBe("2023-04-05");
  });
});
