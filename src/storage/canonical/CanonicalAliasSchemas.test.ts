/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  CanonicalCompanyAliasPrimaryKeyNames,
  CanonicalCompanyAliasSchema,
  CanonicalPersonAliasPrimaryKeyNames,
  CanonicalPersonAliasSchema,
} from "./CanonicalAliasSchemas";

describe("CanonicalPersonAliasSchema", () => {
  it("accepts a fully-populated alias row", () => {
    expect(
      Value.Check(CanonicalPersonAliasSchema, {
        alias_canonical_id: "550e8400-e29b-41d4-a716-446655440000",
        target_canonical_id: "650e8400-e29b-41d4-a716-446655440001",
        reason: "Same person under two CIKs",
        created_at: "2026-05-22T00:00:00.000Z",
        created_by: "operator",
      })
    ).toBe(true);
  });

  it("accepts a minimal alias row with null reason and created_by", () => {
    expect(
      Value.Check(CanonicalPersonAliasSchema, {
        alias_canonical_id: "550e8400-e29b-41d4-a716-446655440000",
        target_canonical_id: "650e8400-e29b-41d4-a716-446655440001",
        reason: null,
        created_at: "2026-05-22T00:00:00.000Z",
        created_by: null,
      })
    ).toBe(true);
  });

  it("PK is single-column on alias_canonical_id", () => {
    expect(CanonicalPersonAliasPrimaryKeyNames).toEqual(["alias_canonical_id"]);
  });
});

describe("CanonicalCompanyAliasSchema", () => {
  it("accepts an alias row", () => {
    expect(
      Value.Check(CanonicalCompanyAliasSchema, {
        alias_canonical_id: "750e8400-e29b-41d4-a716-446655440002",
        target_canonical_id: "850e8400-e29b-41d4-a716-446655440003",
        reason: "Same broker-dealer under CIK and CRD",
        created_at: "2026-05-22T00:00:00.000Z",
        created_by: "operator",
      })
    ).toBe(true);
  });

  it("PK is single-column on alias_canonical_id", () => {
    expect(CanonicalCompanyAliasPrimaryKeyNames).toEqual(["alias_canonical_id"]);
  });
});
