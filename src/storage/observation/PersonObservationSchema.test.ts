/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Value } from "typebox/value";
import { PersonObservationSchema } from "./PersonObservationSchema";

describe("PersonObservationSchema", () => {
  it("accepts a fully-populated row", () => {
    const row = {
      observation_id: 1,
      accession_number: "0001234567-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      source_filing_issuer_cik: 1234567,
      cik: 7654321,
      first_name: "Jane",
      middle_name: "Q",
      last_name: "Smith",
      suffix: null,
      normalized_first: "jane",
      normalized_middle: "q",
      normalized_last: "smith",
      normalized_suffix: null,
      title: "CEO",
      relationship: "Executive Officer",
      raw_address_id: "addr-abc",
      raw_phone_id: null,
      source_context: '{"raw":"yes"}',
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(PersonObservationSchema, row)).toBe(true);
  });

  it("accepts a minimal row with most fields null", () => {
    const row = {
      observation_id: 2,
      accession_number: "0001234567-25-000002",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 1,
      source_filing_issuer_cik: null,
      cik: null,
      first_name: null,
      middle_name: null,
      last_name: "Smith",
      suffix: null,
      normalized_first: null,
      normalized_middle: null,
      normalized_last: "smith",
      normalized_suffix: null,
      title: null,
      relationship: null,
      raw_address_id: null,
      raw_phone_id: null,
      source_context: null,
      created_at: "2026-05-22T00:00:00.000Z",
    };
    expect(Value.Check(PersonObservationSchema, row)).toBe(true);
  });
});
