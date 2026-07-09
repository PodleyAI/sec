/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  defaultQuarters,
  parseFormCodes,
  parseQuarterStrings,
  quarterToDate,
} from "./fetchFixtures";

describe("parseFormCodes", () => {
  it("returns the codes unchanged when they're all known", () => {
    expect(parseFormCodes(["C", "D", "1-A POS"])).toEqual(["C", "D", "1-A POS"]);
  });

  it("throws on the first unknown form code", () => {
    expect(() => parseFormCodes(["C", "FOO", "D"])).toThrow(/Unsupported form code "FOO"/);
  });
});

describe("parseQuarterStrings", () => {
  it("accepts canonical YYYYQn quarters", () => {
    expect(parseQuarterStrings(["2025Q1", "2024Q4"])).toEqual(["2025Q1", "2024Q4"]);
  });

  it("rejects shapes that aren't YYYYQn", () => {
    expect(() => parseQuarterStrings(["2025-Q1"])).toThrow(/must look like 2025Q1/);
    expect(() => parseQuarterStrings(["25Q1"])).toThrow(/must look like 2025Q1/);
    expect(() => parseQuarterStrings(["2025Q5"])).toThrow(/must look like 2025Q1/);
  });
});

describe("quarterToDate", () => {
  it("returns a date inside the requested quarter", () => {
    expect(quarterToDate("2025Q1")).toBe("2025-01-15");
    expect(quarterToDate("2025Q2")).toBe("2025-04-15");
    expect(quarterToDate("2025Q3")).toBe("2025-07-15");
    expect(quarterToDate("2024Q4")).toBe("2024-10-15");
  });

  it("throws on a malformed quarter", () => {
    expect(() => quarterToDate("foo")).toThrow(/Invalid quarter/);
  });
});

describe("defaultQuarters", () => {
  it("returns two settled quarters (skipping the in-progress one)", () => {
    // Inside 2025Q3 -> back 2 = Q1, back 3 = 2024Q4.
    expect(defaultQuarters(new Date(Date.UTC(2025, 7, 15)))).toEqual(["2025Q1", "2024Q4"]);
  });

  it("wraps across year boundaries", () => {
    // Inside 2025Q1 -> back 2 = 2024Q3, back 3 = 2024Q2.
    expect(defaultQuarters(new Date(Date.UTC(2025, 1, 1)))).toEqual(["2024Q3", "2024Q2"]);
  });

  it("returns exactly two quarters", () => {
    const result = defaultQuarters(new Date(Date.UTC(2025, 0, 1)));
    expect(result).toHaveLength(2);
  });
});
