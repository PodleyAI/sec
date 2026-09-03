/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import {
  ALL_SECURITIES_OFFERED_TYPES,
  LONG_FILE_NUMBER,
  LONG_PHONE_INTERNATIONAL,
} from "./schemaRoundTripFixtures";
import { withSqliteDb } from "./testing/withSqliteDb";

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
});
