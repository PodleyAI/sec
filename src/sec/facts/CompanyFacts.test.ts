/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Value } from "typebox/value";
import { CompanyFactsSchema } from "../../storage/facts/CompanyFactsSchema";
import { FactoidSchema, FP, normalizeFp, type Factoid } from "./CompanyFacts";

/**
 * Regression coverage for the constraint widths that rejected real EDGAR
 * company-facts during a full bootstrap:
 *  - `fp` beyond the four quarters + FY (EDGAR emits `CY` / `H1` / `H2`),
 *  - `val_unit` longer than 12 chars (composite units run to ~20),
 *  - `grouping` longer than 8 chars (`ifrs-full` is 9).
 * All three surfaced as `STORE_ERROR`s that lost the whole CIK's facts.
 */

function factoid(overrides: Partial<Factoid>): Factoid {
  return {
    cik: 1018724,
    grouping: "us-gaap",
    name: "Revenues",
    filed_date: "2026-04-15",
    form: "10-K",
    val_unit: "USD",
    val: 12345678,
    frame: null,
    accession_number: "0001018724-26-000042",
    start_date: null,
    end_date: "2024-12-31",
    fy: 2024,
    fp: "FY",
    ...overrides,
  };
}

describe("FP fiscal-period codes", () => {
  it("includes the EDGAR calendar-year and half-year codes", () => {
    expect(FP).toEqual(["FY", "Q1", "Q2", "Q3", "Q4", "CY", "H1", "H2"]);
  });
});

describe("normalizeFp", () => {
  for (const code of FP) {
    it(`passes known code "${code}" through`, () => {
      expect(normalizeFp(code)).toBe(code);
    });
  }

  it("maps EDGAR's empty-string period-agnostic fp to null", () => {
    expect(normalizeFp("")).toBeNull();
  });

  it("maps an unrecognized code and non-strings to null", () => {
    expect(normalizeFp("ZZ")).toBeNull();
    expect(normalizeFp(null)).toBeNull();
    expect(normalizeFp(undefined)).toBeNull();
    expect(normalizeFp(3)).toBeNull();
  });
});

describe("FactoidSchema (task-input validation)", () => {
  for (const fp of ["CY", "H1", "H2"] as const) {
    it(`accepts fp="${fp}"`, () => {
      expect(Value.Check(FactoidSchema, factoid({ fp }))).toBe(true);
    });
  }

  it("still rejects an unknown fp code", () => {
    expect(Value.Check(FactoidSchema, factoid({ fp: "ZZ" as never }))).toBe(false);
  });

  it("accepts a 20-char val_unit (previously capped at 12)", () => {
    expect(Value.Check(FactoidSchema, factoid({ val_unit: "USD/entity-per-share" }))).toBe(true);
  });

  it("accepts the 9-char ifrs-full grouping (previously capped at 8)", () => {
    expect(Value.Check(FactoidSchema, factoid({ grouping: "ifrs-full" }))).toBe(true);
  });
});

describe("CompanyFactsSchema (storage validation)", () => {
  it("accepts a 20-char val_unit", () => {
    expect(Value.Check(CompanyFactsSchema, factoid({ val_unit: "USD/entity-per-share" }))).toBe(
      true
    );
  });

  it("accepts the 9-char ifrs-full grouping", () => {
    expect(Value.Check(CompanyFactsSchema, factoid({ grouping: "ifrs-full", fp: "FY" }))).toBe(true);
  });
});
