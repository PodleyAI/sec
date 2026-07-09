/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { CanonicalPersonSchema } from "./CanonicalPersonSchema";

describe("CanonicalPersonSchema", () => {
  it("accepts a fully-populated CIK-keyed canonical row", () => {
    const row = {
      canonical_person_id: "550e8400-e29b-41d4-a716-446655440000",
      resolver_version: "1.0.0",
      display_first: "Jane",
      display_middle: "Q",
      display_last: "Smith",
      display_suffix: null,
      cik: 1234567,
      normalized_first: "jane",
      normalized_middle: "q",
      normalized_last: "smith",
      normalized_suffix: null,
      source_filing_issuer_cik: null,
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(CanonicalPersonSchema, row)).toBe(true);
  });

  it("accepts a name-keyed canonical row with no CIK", () => {
    const row = {
      canonical_person_id: "650e8400-e29b-41d4-a716-446655440001",
      resolver_version: "1.0.0",
      display_first: "John",
      display_middle: null,
      display_last: "Doe",
      display_suffix: null,
      cik: null,
      normalized_first: "john",
      normalized_middle: null,
      normalized_last: "doe",
      normalized_suffix: null,
      source_filing_issuer_cik: 1234567,
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(CanonicalPersonSchema, row)).toBe(true);
  });
});
