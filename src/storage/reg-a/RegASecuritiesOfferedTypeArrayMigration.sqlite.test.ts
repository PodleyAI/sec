/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { ALL_SECURITIES_OFFERED_TYPES } from "../../config/schemaRoundTripFixtures";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { getDb } from "../../util/db";
import { migrateRegASecuritiesOfferedTypeArray } from "./RegASecuritiesOfferedTypeArrayMigration";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "./RegAOfferingSchema";

/**
 * The SQLite arm needs a real database: the legacy encodings only exist as raw
 * column text, which an in-memory repository (holding JS values) cannot hold.
 */
describe("migrateRegASecuritiesOfferedTypeArray (sqlite)", () => {
  withSqliteDb("rega_securities_array_migration", "all");

  /** Writes the raw column text a pre-migration database would carry. */
  function seedLegacy(cik: number, raw: string | null): void {
    getDb()
      .prepare(
        `INSERT INTO rega_offerings
           (cik, file_number, issuer_name, jurisdiction, sic_code, tier,
            financial_statement_audit_status, securities_offered_type,
            industry_group, status, as_of)
         VALUES (?, ?, 'Legacy Issuer Inc', 'DE', NULL, 'Tier2',
                 NULL, ?, NULL, 'pending', '2024-01-01')`
      )
      .run(cik, `024-${cik}`, raw);
  }

  function rawColumn(cik: number): string | null {
    const row = getDb()
      .prepare<
        [number],
        { securities_offered_type: string | null }
      >(`SELECT securities_offered_type FROM rega_offerings WHERE cik = ?`)
      .get(cik);
    return row?.securities_offered_type ?? null;
  }

  async function read(cik: number) {
    return await globalServiceRegistry
      .get(REGA_OFFERING_REPOSITORY_TOKEN)
      .get({ cik, file_number: `024-${cik}` });
  }

  it("wraps a legacy single selection so the repo returns a list", async () => {
    seedLegacy(1001, "Debt");
    // The pre-migration read is the bug: the declared type is now an array, but
    // the stored text is a bare scalar.
    expect((await read(1001))?.securities_offered_type).not.toEqual(["Debt"]);

    await migrateRegASecuritiesOfferedTypeArray();

    expect((await read(1001))?.securities_offered_type).toEqual(["Debt"]);
  });

  it("leaves a legacy multi-selection untouched", async () => {
    // A multi-select was ALREADY written as JSON, because the storage layer
    // stringifies a JS array whatever the column declares. Only the arity of
    // the declared type was wrong, so there is nothing to convert here — and
    // double-wrapping it would be the actual data loss.
    const json = JSON.stringify(ALL_SECURITIES_OFFERED_TYPES);
    seedLegacy(1002, json);

    await migrateRegASecuritiesOfferedTypeArray();

    expect(rawColumn(1002)).toBe(json);
    expect((await read(1002))?.securities_offered_type).toEqual(ALL_SECURITIES_OFFERED_TYPES);
  });

  it("leaves a null value null", async () => {
    seedLegacy(1003, null);
    await migrateRegASecuritiesOfferedTypeArray();
    expect((await read(1003))?.securities_offered_type).toBeNull();
  });

  it("is a no-op on a second run", async () => {
    seedLegacy(1004, "Debt");
    await migrateRegASecuritiesOfferedTypeArray();
    const afterFirst = rawColumn(1004);

    await migrateRegASecuritiesOfferedTypeArray();

    expect(rawColumn(1004)).toBe(afterFirst);
    expect((await read(1004))?.securities_offered_type).toEqual(["Debt"]);
  });

  it("round-trips a value written through the repo after migrating", async () => {
    await globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN).put({
      cik: 1005,
      file_number: "024-1005",
      issuer_name: "Fresh Issuer Inc",
      jurisdiction: "DE",
      sic_code: null,
      tier: "Tier2",
      financial_statement_audit_status: null,
      securities_offered_type: ALL_SECURITIES_OFFERED_TYPES,
      industry_group: null,
      status: "pending",
      as_of: "2024-02-02",
    });

    await migrateRegASecuritiesOfferedTypeArray();

    expect((await read(1005))?.securities_offered_type).toEqual(ALL_SECURITIES_OFFERED_TYPES);
  });
});
