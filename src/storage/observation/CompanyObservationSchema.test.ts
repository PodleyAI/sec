/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Value } from "typebox/value";
import { CompanyObservationSchema } from "./CompanyObservationSchema";

describe("CompanyObservationSchema", () => {
  it("accepts a fully-populated row with CIK and CRD and name", () => {
    const row = {
      observation_id: 1,
      accession_number: "0001234567-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      cik: 1234567,
      crd_number: "987654",
      name: "Acme Holdings LLC",
      normalized_name: "acme holdings llc",
      jurisdiction: "DE",
      entity_type: "LLC",
      raw_address_id: "addr-abc",
      raw_phone_id: "+15551234567",
      source_context: '{"relation":"form-d:issuer"}',
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(CompanyObservationSchema, row)).toBe(true);
  });

  it("accepts a minimal name-only row with most fields null", () => {
    const row = {
      observation_id: 2,
      accession_number: "0001234567-25-000002",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 1,
      cik: null,
      crd_number: null,
      name: "Acme Holdings LLC",
      normalized_name: "acme holdings llc",
      jurisdiction: null,
      entity_type: null,
      raw_address_id: null,
      raw_phone_id: null,
      source_context: null,
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(CompanyObservationSchema, row)).toBe(true);
  });
});
