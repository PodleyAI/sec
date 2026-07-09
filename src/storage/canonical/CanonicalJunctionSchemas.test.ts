/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  CanonicalPersonAddressSchema,
  CanonicalPersonPhoneSchema,
  CanonicalCompanyAddressSchema,
  CanonicalCompanyPhoneSchema,
} from "./CanonicalJunctionSchemas";

describe("CanonicalPersonAddressSchema", () => {
  it("accepts a junction row", () => {
    expect(
      Value.Check(CanonicalPersonAddressSchema, {
        canonical_person_id: "550e8400-e29b-41d4-a716-446655440000",
        address_hash_id: "addr-abc-123",
        resolver_version: "1.0.0",
        observation_count: 3,
        first_seen_at: "2026-05-22T00:00:00.000Z",
        last_seen_at: "2026-05-23T00:00:00.000Z",
      })
    ).toBe(true);
  });

  it("rejects observation_count of zero (minimum 1)", () => {
    expect(
      Value.Check(CanonicalPersonAddressSchema, {
        canonical_person_id: "550e8400-e29b-41d4-a716-446655440000",
        address_hash_id: "addr-abc-123",
        resolver_version: "1.0.0",
        observation_count: 0,
        first_seen_at: "2026-05-22T00:00:00.000Z",
        last_seen_at: "2026-05-22T00:00:00.000Z",
      })
    ).toBe(false);
  });
});

describe("CanonicalPersonPhoneSchema", () => {
  it("accepts a junction row", () => {
    expect(
      Value.Check(CanonicalPersonPhoneSchema, {
        canonical_person_id: "550e8400-e29b-41d4-a716-446655440000",
        international_number: "+15551234567",
        resolver_version: "1.0.0",
        observation_count: 1,
        first_seen_at: "2026-05-22T00:00:00.000Z",
        last_seen_at: "2026-05-22T00:00:00.000Z",
      })
    ).toBe(true);
  });
});

describe("CanonicalCompanyAddressSchema", () => {
  it("accepts a junction row", () => {
    expect(
      Value.Check(CanonicalCompanyAddressSchema, {
        canonical_company_id: "750e8400-e29b-41d4-a716-446655440000",
        address_hash_id: "addr-corp-1",
        resolver_version: "1.0.0",
        observation_count: 5,
        first_seen_at: "2026-05-22T00:00:00.000Z",
        last_seen_at: "2026-05-25T00:00:00.000Z",
      })
    ).toBe(true);
  });
});

describe("CanonicalCompanyPhoneSchema", () => {
  it("accepts a junction row", () => {
    expect(
      Value.Check(CanonicalCompanyPhoneSchema, {
        canonical_company_id: "750e8400-e29b-41d4-a716-446655440000",
        international_number: "+442075551234",
        resolver_version: "1.0.0",
        observation_count: 2,
        first_seen_at: "2026-05-22T00:00:00.000Z",
        last_seen_at: "2026-05-24T00:00:00.000Z",
      })
    ).toBe(true);
  });
});
