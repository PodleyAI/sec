/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { getPgPool } from "../util/pg";
import { planColumnAlignment, type LiveColumn } from "./alignPostgresColumnTypes";
import { DefaultDI } from "./DefaultDI";
import { planStaleCheckDrops, type LiveCheckConstraint } from "./dropStaleCheckConstraints";
import { resetAllDatabases } from "./resetAllDatabases";
import { LONG_FILE_NUMBER } from "./schemaRoundTripFixtures";
import { setupAllDatabases } from "./setupAllDatabases";
import { listRegisteredTables } from "./tableRegistry";
import { resetDependencyInjectionsForTesting } from "./TestingDI";
import { SEC_DB_TYPE, SEC_PG_URL } from "./tokens";

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
    // `crd_number` is part of a primary key, which is the case the widening
    // pass has to get right: Postgres rebuilds the index behind it.
    await pool.query(`ALTER TABLE "adv_adviser" ALTER COLUMN "crd_number" TYPE varchar(8)`);
    await pool.query(`ALTER TABLE "filings" ALTER COLUMN "file_number" TYPE varchar(10)`);
    await pool.query(`ALTER TABLE "filings" ALTER COLUMN "form" TYPE varchar(8)`);
    await pool.query(`UPDATE "adv_adviser" SET "legal_name" = 'unnamed'
                       WHERE "legal_name" IS NULL`);
    await pool.query(`ALTER TABLE "adv_adviser" ALTER COLUMN "legal_name" SET NOT NULL`);

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
      live.find((c) => c.table === "adv_adviser" && c.column === "legal_name")?.isNullable
    ).toBe(true);
  });

  async function liveChecks(): Promise<LiveCheckConstraint[]> {
    const result = await getPgPool().query(
      `SELECT c.relname AS table_name,
              con.conname AS constraint_name,
              pg_get_constraintdef(con.oid) AS definition,
              coalesce(
                (SELECT array_agg(a.attname::text ORDER BY a.attnum)
                   FROM unnest(con.conkey) AS k(attnum)
                   JOIN pg_attribute a
                     ON a.attrelid = con.conrelid AND a.attnum = k.attnum),
                '{}'
              ) AS columns
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE con.contype = 'c' AND n.nspname = current_schema()`
    );
    return (
      result.rows as {
        table_name: string;
        constraint_name: string;
        definition: string;
        columns: string[] | null;
      }[]
    ).map((row) => ({
      table: row.table_name,
      name: row.constraint_name,
      definition: row.definition,
      columns: row.columns ?? [],
    }));
  }

  /**
   * A bound the storage layer emits from a `minimum: 0` the schema no longer
   * declares — the reason the drop pass exists. Recreated exactly as it was
   * emitted, because the pass matches on that shape and nothing else.
   */
  it("drops a CHECK the schema no longer declares, and keeps the ones it does", async () => {
    const pool = getPgPool();
    await pool.query(
      `ALTER TABLE "company_facts"
         ADD CONSTRAINT "company_facts_val_check"
         CHECK ("val" >= 0)`
    );
    // An operator's own bound on the same relaxed column. `db setup` must not
    // touch it: this pass removes what the storage layer stopped declaring, and
    // has no claim on anything else in the database.
    await pool.query(
      `ALTER TABLE "company_facts"
         ADD CONSTRAINT "operator_val_sanity"
         CHECK ("val" >= -1000000 AND "val" <= 1000000)`
    );

    await setupAllDatabases();

    const names = new Set((await liveChecks()).map((c) => c.name));
    expect(names.has("company_facts_val_check")).toBe(false);
    expect(names.has("operator_val_sanity")).toBe(true);
    // `cik` is still declared unsigned, so its emitted bound is current.
    expect(names.has("company_facts_cik_check")).toBe(true);

    // And the negative value the stale bound rejected now stores, which is the
    // whole point — a filer reporting a net loss.
    await pool.query(
      `INSERT INTO "company_facts"
         ("cik", "grouping", "name", "filed_date", "form", "val_unit",
          "accession_number", "val", "fy", "fp")
       VALUES (1792525, 'us-gaap', 'NetIncomeLoss', '2020-08-17', '10-K', 'USD',
               '0001193125-20-000001', -89617, 2020, 'FY')`
    );

    // Asserted through the planner, like the alignment case above: an empty
    // plan IS "no declared column carries a bound the schema dropped".
    expect(
      planStaleCheckDrops(listRegisteredTables(), await liveChecks(), "public").map((s) => s.sql)
    ).toEqual([]);

    await pool.query(`ALTER TABLE "company_facts" DROP CONSTRAINT "operator_val_sanity"`);
  });

  it("round-trips the same values the sqlite suite asserts", async () => {
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
