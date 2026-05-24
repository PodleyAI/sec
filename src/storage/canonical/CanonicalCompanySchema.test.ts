/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Value } from "typebox/value";
import { CanonicalCompanySchema } from "./CanonicalCompanySchema";

describe("CanonicalCompanySchema", () => {
  it("accepts a CIK-keyed canonical row", () => {
    const row = {
      canonical_company_id: "550e8400-e29b-41d4-a716-446655440000",
      resolver_version: "1.0.0",
      display_name: "Acme Holdings LLC",
      cik: 1234567,
      crd_number: null,
      normalized_name: null,
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(CanonicalCompanySchema, row)).toBe(true);
  });

  it("accepts a CRD-keyed canonical row", () => {
    const row = {
      canonical_company_id: "650e8400-e29b-41d4-a716-446655440001",
      resolver_version: "1.0.0",
      display_name: "Wells Fargo Securities",
      cik: null,
      crd_number: "126292",
      normalized_name: null,
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(CanonicalCompanySchema, row)).toBe(true);
  });

  it("accepts a name-keyed canonical row with no CIK or CRD", () => {
    const row = {
      canonical_company_id: "750e8400-e29b-41d4-a716-446655440002",
      resolver_version: "1.0.0",
      display_name: "Local Investments LLC",
      cik: null,
      crd_number: null,
      normalized_name: "local investments llc",
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(CanonicalCompanySchema, row)).toBe(true);
  });
});
