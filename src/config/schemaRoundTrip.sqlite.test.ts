/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import {
  ALL_SECURITIES_OFFERED_TYPES,
  LONG_FILE_NUMBER,
  LONG_PHONE_INTERNATIONAL,
} from "./schemaRoundTripFixtures";
import { withSqliteDb } from "./testing/withSqliteDb";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { PHONE_REPOSITORY_TOKEN } from "../storage/phone/PhoneSchema";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingSchema";

/**
 * Round-trips the two values that overflowed their original column widths.
 * The Postgres arm of this lives in `postgresSchemaParity.integration.test.ts`
 * and uses the same fixtures, so the two backends are asserted against
 * identical input.
 */
describe("schema round-trip (sqlite)", () => {
  // "all": these two writes go through repos whose DDL the full setup emits,
  // and the point of the suite is the shape `db setup` actually produces.
  withSqliteDb("schema_roundtrip_test", "all");

  it("stores and reads back a 24-char normalized phone number (a primary key)", async () => {
    const repo = globalServiceRegistry.get(PHONE_REPOSITORY_TOKEN);
    await repo.put({
      country_code: "US",
      international_number: LONG_PHONE_INTERNATIONAL,
      raw_phone: "5164821200 EXT. 108",
    });
    const stored = await repo.get({ international_number: LONG_PHONE_INTERNATIONAL });
    expect(stored?.international_number).toBe(LONG_PHONE_INTERNATIONAL);
  });

  it("stores and reads back a 107-char comma-joined file number", async () => {
    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await repo.put({
      cik: 320193,
      accession_number: "0001193125-24-000001",
      filing_date: "2024-01-15",
      report_date: null,
      acceptance_date: "2024-01-15T16:30:00.000Z",
      form: "8-K",
      file_number: LONG_FILE_NUMBER,
      film_number: null,
      primary_doc: "d123456d8k.htm",
      primary_doc_description: null,
      size: 1024,
      is_xbrl: false,
      is_inline_xbrl: false,
      items: null,
      act: "34",
    });
    const stored = await repo.get({
      cik: 320193,
      accession_number: "0001193125-24-000001",
    });
    expect(stored?.file_number).toBe(LONG_FILE_NUMBER);
  });

  it("stores and reads back all six securities-offered types as a list", async () => {
    const repo = globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN);
    await repo.put({
      cik: 1750,
      file_number: "024-11111",
      issuer_name: "Multi Select Inc",
      jurisdiction: "DE",
      sic_code: 7372,
      tier: "Tier2",
      financial_statement_audit_status: "Audited",
      securities_offered_type: ALL_SECURITIES_OFFERED_TYPES,
      industry_group: "Other",
      status: "pending",
      as_of: "2024-02-02",
    });
    const stored = await repo.get({ cik: 1750, file_number: "024-11111" });
    // Element-wise, not just deep-equal: SQLite stores this as JSON text and
    // Postgres as text[], and the point is that neither shows through here.
    expect(stored?.securities_offered_type).toEqual(ALL_SECURITIES_OFFERED_TYPES);
  });
});
