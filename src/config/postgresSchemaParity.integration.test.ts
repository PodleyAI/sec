/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { DefaultDI } from "./DefaultDI";
import { planColumnAlignment, type LiveColumn } from "./alignPostgresColumnTypes";
import { resetAllDatabases } from "./resetAllDatabases";
import { setupAllDatabases } from "./setupAllDatabases";
import { LONG_FILE_NUMBER, LONG_PHONE_INTERNATIONAL } from "./schemaRoundTripFixtures";
import { listRegisteredTables } from "./tableRegistry";
import { resetDependencyInjectionsForTesting } from "./TestingDI";
import { SEC_DB_TYPE, SEC_PG_URL } from "./tokens";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { PHONE_REPOSITORY_TOKEN } from "../storage/phone/PhoneSchema";
import { getPgPool } from "../util/pg";

/**
 * Live-Postgres parity: only SQLite is exercised by the normal suite, and
 * SQLite emits TEXT for every string — so a column width or a NOT NULL that
 * exists only on Postgres is invisible to every other test in this repo. This
 * suite degrades a scratch schema back to the pre-widening shape, re-runs
 * `db setup`, and asserts that every declared column came back into line.
 *
 * Requires a throwaway Postgres. Skipped (not failed) without `SEC_PG_URL`.
 */
const PG_URL = process.env.SEC_PG_URL;

describe.skipIf(!PG_URL)("postgres schema parity", () => {
  beforeAll(async () => {
    resetDependencyInjectionsForTesting();
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    globalServiceRegistry.registerInstance(SEC_PG_URL, PG_URL!);
    DefaultDI();
    await resetAllDatabases({ cascade: true });
    await setupAllDatabases();
  });

  afterAll(async () => {
    await resetAllDatabases({ cascade: true });
    resetDependencyInjectionsForTesting();
  });

  async function liveColumns(): Promise<LiveColumn[]> {
    const pool = getPgPool();
    const result = await pool.query(
      `SELECT table_name, column_name, character_maximum_length, is_nullable
         FROM information_schema.columns
        WHERE table_schema = current_schema()`
    );
    return (
      result.rows as {
        table_name: string;
        column_name: string;
        character_maximum_length: number | null;
        is_nullable: string;
      }[]
    ).map((row) => ({
      table: row.table_name,
      column: row.column_name,
      characterMaximumLength: row.character_maximum_length,
      isNullable: row.is_nullable === "YES",
    }));
  }

  it("brings a degraded schema back into line with every declared column", async () => {
    const pool = getPgPool();
    // Degrade to the pre-widening shape: narrow the widened columns and
    // re-tighten the relaxed one. `db setup` alone (CREATE TABLE IF NOT
    // EXISTS) cannot undo either — the alignment pass is what does.
    await pool.query(`ALTER TABLE "phones" ALTER COLUMN "international_number" TYPE varchar(20)`);
    await pool.query(`ALTER TABLE "filings" ALTER COLUMN "file_number" TYPE varchar(10)`);
    await pool.query(`ALTER TABLE "filings" ALTER COLUMN "form" TYPE varchar(8)`);
    await pool.query(`UPDATE "addresses" SET "state_or_country" = 'CA'
                       WHERE "state_or_country" IS NULL`);
    await pool.query(`ALTER TABLE "addresses" ALTER COLUMN "state_or_country" SET NOT NULL`);

    await setupAllDatabases();

    // Generic assertion over the ownership registry rather than a fixed list:
    // a column widened tomorrow is covered without touching this test. Asserted
    // through the planner itself, so the declared-shape rules cannot drift from
    // the ones `db setup` actually applies — an empty plan IS "the live schema
    // matches every declared column".
    const live = await liveColumns();
    // The schema is only used to qualify the statements; an empty plan has
    // none, so any name does.
    expect(planColumnAlignment(listRegisteredTables(), live, "public").map((s) => s.sql)).toEqual(
      []
    );
    expect(
      live.find((c) => c.table === "addresses" && c.column === "state_or_country")?.isNullable
    ).toBe(true);
  });

  it("round-trips the same values the sqlite suite asserts", async () => {
    await globalServiceRegistry.get(PHONE_REPOSITORY_TOKEN).put({
      country_code: "US",
      international_number: LONG_PHONE_INTERNATIONAL,
      raw_phone: "5164821200 EXT. 108",
    });
    const phone = await globalServiceRegistry
      .get(PHONE_REPOSITORY_TOKEN)
      .get({ international_number: LONG_PHONE_INTERNATIONAL });
    expect(phone?.international_number).toBe(LONG_PHONE_INTERNATIONAL);

    await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
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
    const filing = await globalServiceRegistry
      .get(FILING_REPOSITORY_TOKEN)
      .get({ cik: 320193, accession_number: "0001193125-24-000001" });
    expect(filing?.file_number).toBe(LONG_FILE_NUMBER);
  });

  it("leaves tables sec does not own in place", async () => {
    const pool = getPgPool();
    await pool.query(`CREATE TABLE IF NOT EXISTS "not_ours" (id integer PRIMARY KEY)`);
    try {
      await resetAllDatabases();
      const survivors = await pool.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'not_ours'`
      );
      expect(survivors.rowCount).toBe(1);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS "not_ours"`);
      await setupAllDatabases();
    }
  });

  it("raises an actionable error when a dependent view blocks a drop", async () => {
    const pool = getPgPool();
    await pool.query(`CREATE OR REPLACE VIEW "filings_report" AS SELECT cik FROM "filings"`);
    try {
      await expect(resetAllDatabases()).rejects.toThrow(/--cascade/);
      await expect(resetAllDatabases()).rejects.toThrow(/filings_report/);
    } finally {
      await pool.query(`DROP VIEW IF EXISTS "filings_report"`);
      await setupAllDatabases();
    }
  });

  it("drops a dependent view with --cascade", async () => {
    const pool = getPgPool();
    await setupAllDatabases();
    await pool.query(`CREATE OR REPLACE VIEW "filings_report" AS SELECT cik FROM "filings"`);
    await resetAllDatabases({ cascade: true });
    const remaining = await pool.query(
      `SELECT 1 FROM information_schema.views
        WHERE table_schema = current_schema() AND table_name = 'filings_report'`
    );
    expect(remaining.rowCount).toBe(0);
    await setupAllDatabases();
  });
});
