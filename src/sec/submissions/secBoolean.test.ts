/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import { objectOfArraysAsArrayOfObjects } from "workglow";
import { secBooleanFromWire, TypeFilings } from "./EnititySubmissionSchema";

describe("secBooleanFromWire", () => {
  it("accepts every spelling EDGAR uses for true", () => {
    for (const wire of [true, 1, "1", "true", "Y"]) {
      expect(secBooleanFromWire(wire)).toBe(true);
    }
  });

  it("rejects the false spellings and anything unrecognised", () => {
    for (const wire of [false, 0, "0", "false", "N", "", null, undefined]) {
      expect(secBooleanFromWire(wire)).toBe(false);
    }
  });
});

describe("TypeFilings XBRL flags", () => {
  // Regression: submissions JSON sends the integers 0/1, but the codec only
  // tested `value === "1"`, so every filing in the corpus decoded to false and
  // was stored as NULL.
  const page = {
    accessionNumber: ["0000320193-24-000123", "0000320193-24-000124"],
    filingDate: ["2024-11-01", "2024-08-02"],
    reportDate: ["2024-09-28", "2024-06-29"],
    acceptanceDateTime: ["2024-11-01T06:01:36.000Z", "2024-08-02T06:03:52.000Z"],
    act: ["34", "34"],
    form: ["10-K", "10-Q"],
    filmNumber: ["241416538", "241166448"],
    fileNumber: ["001-36743", "001-36743"],
    items: ["", ""],
    size: [8_000_000, 6_000_000],
    isXBRL: [1, 0],
    isInlineXBRL: [1, 0],
    isXBRLNumeric: [1, 0],
    primaryDocument: ["aapl-20240928.htm", "aapl-20240629.htm"],
    primaryDocDescription: ["10-K", "10-Q"],
  };

  it("decodes integer 1 to true and 0 to false", () => {
    const decoded = Value.Encode(TypeFilings(), page);
    expect(decoded.isXBRL).toEqual([true, false]);
    expect(decoded.isInlineXBRL).toEqual([true, false]);
    expect(decoded.isXBRLNumeric).toEqual([true, false]);
  });

  it("survives a payload predating isXBRLNumeric", () => {
    const { isXBRLNumeric, ...legacy } = page;
    const decoded = Value.Encode(TypeFilings(), legacy);
    expect(decoded.isXBRL).toEqual([true, false]);
    expect(decoded.isXBRLNumeric).toBeUndefined();
  });

  it("carries the flags through the columnar-to-row proxy", () => {
    const decoded = Value.Encode(TypeFilings(), page);
    const rows = [...objectOfArraysAsArrayOfObjects(decoded)];
    expect(rows.map((r) => r.isXBRL)).toEqual([true, false]);
    expect(rows.map((r) => r.isXBRLNumeric)).toEqual([true, false]);
  });
});
