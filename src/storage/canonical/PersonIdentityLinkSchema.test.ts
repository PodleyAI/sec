/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Value } from "typebox/value";
import { PersonIdentityLinkSchema } from "./PersonIdentityLinkSchema";

describe("PersonIdentityLinkSchema", () => {
  it("accepts a link row", () => {
    const row = {
      observation_id: 42,
      resolver_version: "1.0.0",
      canonical_person_id: "550e8400-e29b-41d4-a716-446655440000",
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(PersonIdentityLinkSchema, row)).toBe(true);
  });

  it("accepts a link at a different resolver_version for the same observation", () => {
    const row = {
      observation_id: 42,
      resolver_version: "2.0.0",
      canonical_person_id: "650e8400-e29b-41d4-a716-446655440001",
      created_at: "2026-05-23T00:00:00.000Z",
    };
    expect(Value.Check(PersonIdentityLinkSchema, row)).toBe(true);
  });
});
