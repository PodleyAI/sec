/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
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
