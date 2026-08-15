/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { toSecuritiesOfferedTypes } from "../../sec/forms/exempt-offerings/Form_1_A.storage";
import { RegAOfferingSchema } from "./RegAOfferingSchema";

/**
 * `securities_offered_type` must stay an ARRAY, because the form is a
 * multi-select: Form 1-A declares `securitiesOfferedTypes` as
 * `maxOccurs="6"` over a six-value enumeration.
 *
 * Declared as a single string it was wrong about cardinality, and the width was
 * only the symptom: the longest single enum value is 90 characters and fits a
 * varchar(100) fine, so nothing failed until a filer selected TWO — at which
 * point the pair was stringified into a Postgres array literal, blew past 100,
 * and took the whole filing down with a STORE_ERROR. Widening the column would
 * have hidden that while leaving the list unqueryable as a list.
 *
 * The arity is read from the XSD rather than hardcoded, so if EDGAR ever makes
 * the element single-valued this fails instead of preserving a stale shape.
 */
describe("RegAOfferingSchema.securities_offered_type", () => {
  const xsd = readFileSync(
    join(__dirname, "..", "..", "sec", "forms", "exempt-offerings", "Form_1_A.definition.filer.xsd"),
    "utf-8"
  );

  it("is declared multi-valued by the EDGAR XSD", () => {
    const m = /<xs:element name="securitiesOfferedTypes"[^>]*maxOccurs="(\d+)"/.exec(xsd);
    expect(m, "XSD no longer declares securitiesOfferedTypes with maxOccurs").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(1);
  });

  it("is an array type in the storage schema", () => {
    const prop = RegAOfferingSchema.properties.securities_offered_type as Record<string, unknown>;
    const branches = (Array.isArray(prop.anyOf) ? prop.anyOf : [prop]) as Array<
      Record<string, unknown>
    >;
    expect(
      branches.some((b) => b.type === "array"),
      "securities_offered_type must be an array — a single string cannot hold a multi-select"
    ).toBe(true);
  });

  it("declares no maxLength", () => {
    // A length bound here would be the old bug wearing a different hat: the
    // constraint that matters is the enumeration, not a character count.
    const prop = RegAOfferingSchema.properties.securities_offered_type as Record<string, unknown>;
    const branches = (Array.isArray(prop.anyOf) ? prop.anyOf : [prop]) as Array<
      Record<string, unknown>
    >;
    for (const b of branches) expect(b.maxLength).toBe(undefined);
  });
});

/**
 * The parser follows the document — one selection is a scalar, several are an
 * array — so the storage boundary is what makes the shape uniform.
 */
describe("toSecuritiesOfferedTypes", () => {
  it("wraps a single selection", () => {
    expect(toSecuritiesOfferedTypes("Debt")).toEqual(["Debt"]);
  });

  it("passes a multi-selection through", () => {
    expect(
      toSecuritiesOfferedTypes(["Equity (common or preferred stock)", "Debt"])
    ).toEqual(["Equity (common or preferred stock)", "Debt"]);
  });

  it("holds the longest real combination without truncating", () => {
    // All six enum values — the case that overflowed varchar(100) at ~250 chars.
    const all = [
      "Equity (common or preferred stock)",
      "Debt",
      "Option, warrant or other right to acquire another security",
      "Security to be acquired upon exercise of option, warrant or other right to acquire security",
      "Tenant-in-common securities",
      "Other(describe)",
    ];
    const out = toSecuritiesOfferedTypes(all);
    expect(out).toEqual(all);
    expect(out!.join(",").length).toBeGreaterThan(100);
  });

  it("treats absent / empty as null rather than an empty array", () => {
    expect(toSecuritiesOfferedTypes(null)).toBeNull();
    expect(toSecuritiesOfferedTypes(undefined)).toBeNull();
    expect(toSecuritiesOfferedTypes("")).toBeNull();
    expect(toSecuritiesOfferedTypes(["  "])).toBeNull();
  });
});
