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
