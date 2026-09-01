/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { DefaultDI } from "./DefaultDI";
import { resetDependencyInjectionsForTesting } from "./TestingDI";
import { SEC_DB_TYPE } from "./tokens";

/**
 * The Postgres executor, exercised without a Postgres — following the one
 * precedent in this repo for that (`DbStatus.postgres.test.ts`): stub
 * `../util/pg` with a capturing fake pool.
 *
 * The stubs are module-wide, which is why this lives in its own file rather
 * than beside the SQLite tests.
 *
 * The whole point of the file is the SHAPE of the emitted statement, and one
 * choice makes it worth pinning to the character: the schema the fake reports
 * is mixed-case. `current_schema()` returns a name verbatim, and Postgres
 * folds an unquoted identifier to lower case — so a statement that is
 * unqualified, or qualified but unquoted, would still succeed against an
 * ordinary lower-case schema and fail only on the deployment the qualification
 * exists for. Asserting against `Staging` is what makes the test able to fail.
 */
const SCHEMA = "Staging";

const queries: { text: string; values: unknown[] | undefined }[] = [];
/** The live catalog rows the fake `information_schema` probe returns. */
let catalogRows: { table_name: string; column_name: string }[] = [];
/** When set, every `ALTER TABLE` the executor issues rejects with this message. */
let alterFailure: string | null = null;

vi.mock("../util/pg", () => ({
  getPgPool: () => ({
    query: async (text: string, values?: unknown[]) => {
      queries.push({ text, values });
      if (text.includes("current_schema() AS name")) {
        return { rows: [{ name: SCHEMA }] };
      }
      if (text.includes("information_schema.columns")) {
        return { rows: catalogRows };
      }
      if (text.startsWith("ALTER TABLE") && alterFailure !== null) {
        throw new Error(alterFailure);
      }
      return { rows: [] };
    },
  }),
}));

const { addMissingColumnsPostgres } = await import("./addMissingColumns");
const { FilingSchema } = await import("../storage/filing/FilingSchema");

/**
 * The fixture is CONSTRUCTED, exactly as in the SQLite file beside this one: a
 * catalog that reports every `filings` column but this one, so the planner has
 * one thing to plan. It states what the executor emits for a nullable column
 * the live database lacks. It is not a reproduction of the bug the pass exists
 * for — that one needs the column it actually happened to, and belongs with it.
 */
const MISSING_COLUMN = "is_inline_xbrl";

/** The `filings` catalog rows a database missing that one column reports. */
function filingsRowsWithoutIt(): { table_name: string; column_name: string }[] {
  return Object.keys(FilingSchema.properties)
    .filter((c) => c !== MISSING_COLUMN)
    .map((column_name) => ({ table_name: "filings", column_name }));
}

/** Every emitted `ALTER TABLE`, in order. */
function alterStatements(): string[] {
  return queries.map((q) => q.text).filter((text) => text.startsWith("ALTER TABLE"));
}

describe("addMissingColumnsPostgres", () => {
  beforeEach(() => {
    // Restore first: `vi.spyOn(console, "warn")` returns the EXISTING spy when
    // one is already installed, so without this a later test inherits an
    // earlier one's recorded calls and asserts against the wrong message.
    vi.restoreAllMocks();
    // `DefaultDI()` under `SEC_DB_TYPE = "postgres"` is what populates the
    // table registry the planner reads — with the mocked pool standing in for
    // a real one, so no connection is ever opened.
    resetDependencyInjectionsForTesting();
    globalServiceRegistry.registerInstance(SEC_DB_TYPE, "postgres");
    DefaultDI();
    queries.length = 0;
    catalogRows = [];
    alterFailure = null;
  });

  it("emits one schema-qualified, quoted ALTER for the missing column", async () => {
    catalogRows = filingsRowsWithoutIt();

    await addMissingColumnsPostgres();

    // Exactly one statement: only `filings` was reported live, and only one of
    // its columns is missing. Every other registered table is absent from the
    // catalog, so `setupDatabase()` owns it.
    expect(alterStatements()).toEqual([
      `ALTER TABLE "Staging"."filings" ADD COLUMN IF NOT EXISTS "is_inline_xbrl" BOOLEAN`,
    ]);
  });

  it("reads the catalog from current_schema(), the same schema it alters", async () => {
    // The two halves have to agree. Reading `WHERE table_schema =
    // current_schema()` and then altering an unqualified name asks a different
    // question than the one that decided the column is missing.
    catalogRows = filingsRowsWithoutIt();

    await addMissingColumnsPostgres();

    const catalog = queries.find((q) => q.text.includes("information_schema.columns"));
    expect(catalog?.text).toContain("current_schema()");
    // Still parameterized: the table names are bind values, never interpolated.
    expect(catalog?.text).toContain("$1");
  });

  it("emits nothing for a table whose columns are all present", async () => {
    catalogRows = [
      ...filingsRowsWithoutIt(),
      { table_name: "filings", column_name: MISSING_COLUMN },
    ];

    await addMissingColumnsPostgres();

    expect(alterStatements()).toEqual([]);
  });

  it("emits nothing for a table the catalog does not report at all", async () => {
    // Absent from `information_schema` means the table does not exist yet, and
    // `setupDatabase()` creates it whole. Planning an ADD COLUMN per column of
    // a table about to be created correctly would be a statement storm at best.
    catalogRows = [];

    await addMissingColumnsPostgres();

    expect(alterStatements()).toEqual([]);
  });

  it("warns instead of altering when the missing column is NOT NULL", async () => {
    // `filings.filing_date` has no null branch and is `required`, so it is
    // declared NOT NULL. Postgres would reject the ALTER on any non-empty
    // table, and there is no honest default to supply — the operator needs a
    // migration that decides what the backfill means, which is what the warning
    // says.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    catalogRows = filingsRowsWithoutIt().filter((r) => r.column_name !== "filing_date");

    await addMissingColumnsPostgres();

    // The nullable column is still added — one unsupported column must not
    // suppress the rest of the plan.
    expect(alterStatements()).toEqual([
      `ALTER TABLE "Staging"."filings" ADD COLUMN IF NOT EXISTS "is_inline_xbrl" BOOLEAN`,
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]![0]);
    expect(message).toContain("filings.filing_date");
    expect(message).toContain("NOT NULL");
    // Names the two ways out, so the warning is actionable rather than just a
    // report that something was skipped.
    expect(message).toContain("sec db reset");
    expect(message).toContain("migration");
  });

  it("warns and continues when one ALTER fails", async () => {
    // A role without ownership of the table, a lock timeout — anything.
    // Aborting would propagate out of `setupAllDatabases()` and skip everything
    // after it (the alignment pass, the resolver seeding, the rate-limiter
    // tables) over one column.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    catalogRows = filingsRowsWithoutIt();
    alterFailure = "permission denied for table filings";

    await expect(addMissingColumnsPostgres()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("permission denied");
  });
});
