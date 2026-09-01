/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import {
  FILING_REPOSITORY_TOKEN,
  FilingPrimaryKeyNames,
  FilingSchema,
  type Filing,
} from "../storage/filing/FilingSchema";
import { getDb } from "../util/db";
import { TypeNullable } from "../util/TypeBoxUtil";
import { addMissingColumnsSqlite, planMissingColumns } from "./addMissingColumns";
import type { RegisteredTable } from "./tableRegistry";
import { withSqliteDb } from "./testing/withSqliteDb";

/**
 * What this fixture is, and what it is not.
 *
 * It is CONSTRUCTED. `filings.is_inline_xbrl` is dropped from a database `db
 * setup` has just created, and the pass is asked to put it back; no deployment
 * was ever missing that column. What it covers is the mechanism end to end, on
 * a table this package owns: a nullable column the live schema lacks is
 * planned, typed, and added by the SQLite executor, and the `putBulk` that
 * failed without it succeeds.
 *
 * What it does NOT cover is provenance. This pass exists because a column added
 * to a schema long after most databases had been created was added by nothing —
 * `CREATE TABLE IF NOT EXISTS` is a no-op on an existing table, `createStorage`
 * passes no `tabularMigrations`, and `planColumnAlignment` explicitly skips a
 * column the live schema lacks — so the first write of a full row through
 * `putBulk` failed on every pre-existing database. `planMissingColumns`'s own
 * docstring names the column that happened to. Reproducing it takes that column
 * and the task that actually broke, and it belongs with them. Nothing below is
 * that reproduction; do not read it as one.
 */
const MISSING_COLUMN = "is_inline_xbrl";

/** The `filings` column list as it stands once that column is dropped. */
const COLUMNS_WITHOUT_IT = Object.keys(FilingSchema.properties).filter((c) => c !== MISSING_COLUMN);

function liveColumnNames(table: string): string[] {
  return getDb()
    .prepare<[], { name: string }>(`PRAGMA table_info(\`${table}\`)`)
    .all()
    .map((r) => r.name);
}

/**
 * Puts `filings` into the shape a database created before the column would
 * have.
 *
 * `ALTER TABLE ... DROP COLUMN` rather than DROP + re-CREATE: the column is in
 * no index and no primary key, so SQLite accepts the drop, and every other
 * column keeps the type `db setup` gave it — which is what makes the round-trip
 * below a statement about the type the pass ADDED, rather than about a table
 * this test rebuilt by hand.
 */
function dropTheColumn(): void {
  getDb().exec(`ALTER TABLE \`filings\` DROP COLUMN \`${MISSING_COLUMN}\``);
}

function filingRow(): Filing {
  return {
    cik: 320193,
    accession_number: "0001193125-24-000001",
    filing_date: "2024-01-15",
    report_date: null,
    acceptance_date: "2024-01-15T16:30:00.000Z",
    form: "8-K",
    file_number: null,
    film_number: null,
    primary_doc: "d123456d8k.htm",
    primary_doc_description: null,
    size: 1024,
    is_xbrl: false,
    is_inline_xbrl: null,
    items: null,
    act: "34",
  };
}

describe("addMissingColumnsSqlite (real SQLite)", () => {
  // "all" so the table is created by exactly the DDL `db setup` emits, rather
  // than by a hand-written CREATE this test would then be testing against
  // itself.
  withSqliteDb("add_missing_columns_test", "all");

  it("adds a column an existing database lacks, and unbreaks the write", async () => {
    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    dropTheColumn();

    // Two assertions, and the second is the one that matters: the DDL being
    // absent is a symptom, `putBulk` throwing is the user-visible bug. A test
    // that only checked PRAGMA would still pass if the pass added the column
    // under a name or type the repository cannot write through.
    expect(liveColumnNames("filings")).not.toContain(MISSING_COLUMN);
    await expect(repo.putBulk([filingRow()])).rejects.toThrow();

    addMissingColumnsSqlite(getDb());

    expect(liveColumnNames("filings")).toContain(MISSING_COLUMN);
    await expect(repo.putBulk([filingRow()])).resolves.not.toThrow();
  });

  it("round-trips null, true and false through the added boolean column", async () => {
    // SQLite has no BOOLEAN type — a boolean lives in an INTEGER-affinity
    // column — so this is exactly where a wrong type mapping shows up: a column
    // created as TEXT would store "true"/"false" strings and read back
    // something the repository's `sqlToJsValue` does not turn into a boolean.
    // The tri-state matters too: `is_inline_xbrl` is nullable on purpose, since
    // EDGAR omitting the flag is not the same as reporting it false.
    const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    dropTheColumn();
    addMissingColumnsSqlite(getDb());

    await repo.putBulk([
      { ...filingRow(), accession_number: "0000000000-24-000001", is_inline_xbrl: null },
      { ...filingRow(), accession_number: "0000000000-24-000002", is_inline_xbrl: true },
      { ...filingRow(), accession_number: "0000000000-24-000003", is_inline_xbrl: false },
    ]);

    const key = (accession_number: string) => ({ cik: 320193, accession_number });
    expect((await repo.get(key("0000000000-24-000001")))?.is_inline_xbrl).toBeNull();
    expect((await repo.get(key("0000000000-24-000002")))?.is_inline_xbrl).toBe(true);
    expect((await repo.get(key("0000000000-24-000003")))?.is_inline_xbrl).toBe(false);
  });

  it("is idempotent — a second run adds nothing and throws nothing", () => {
    // `db setup` is run repeatedly, and on an already-current database this
    // pass must be silent. A second `ADD COLUMN` for the same name is an error
    // in SQLite, so a planner that did not re-read the live columns would warn
    // on every subsequent setup.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dropTheColumn();

    addMissingColumnsSqlite(getDb());
    const after = liveColumnNames("filings");
    addMissingColumnsSqlite(getDb());

    expect(liveColumnNames("filings")).toEqual(after);
    expect(warn).not.toHaveBeenCalled();
  });

  it("adds nothing at all to a database db setup just created", () => {
    // The fresh-database case: `setupAllDatabases` already emitted the current
    // shape, so the whole registry must plan empty. This is what makes the pass
    // safe to run unconditionally on every `db setup` — including the very
    // first one.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = liveColumnNames("filings");

    addMissingColumnsSqlite(getDb());

    expect(liveColumnNames("filings")).toEqual(before);
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * The planner on its own — pure, so these need no database at all. They cover
 * the two safety rails and the shapes the SQLite test above cannot reach.
 */
describe("planMissingColumns", () => {
  function table(
    name: string,
    schema: unknown,
    primaryKeyNames: ReadonlyArray<string>
  ): RegisteredTable {
    return { table: name, schema: schema as RegisteredTable["schema"], primaryKeyNames };
  }

  it("skips a table that does not exist live", () => {
    // `setupDatabase()` creates a new table whole, with every column. Planning
    // ADD COLUMNs for it would emit a statement per column against a table that
    // is about to be created correctly anyway.
    const declared = [
      table("t", Type.Object({ id: Type.String(), extra: TypeNullable(Type.String()) }), ["id"]),
    ];
    expect(planMissingColumns(declared, new Map())).toEqual([]);
  });

  it("plans nothing when every declared column is already live", () => {
    const declared = [
      table("t", Type.Object({ id: Type.String(), extra: TypeNullable(Type.String()) }), ["id"]),
    ];
    const live = new Map([["t", new Set(["id", "extra"])]]);
    expect(planMissingColumns(declared, live)).toEqual([]);
  });

  it("refuses a NOT NULL column rather than inventing a default", () => {
    // SQLite rejects `ADD COLUMN NOT NULL` without a default outright, and
    // there is no honest default to supply: a value written for every existing
    // row would state something the data does not support. This is a job for a
    // hand-written migration that decides what the backfill MEANS.
    const declared = [
      table(
        "t",
        // Neither property is `Type.Optional`, so TypeBox marks both required.
        Type.Object({ id: Type.String(), required_later: Type.String() }),
        ["id"]
      ),
    ];
    const plan = planMissingColumns(declared, new Map([["t", new Set(["id"])]]));
    expect(plan).toHaveLength(1);
    expect(plan[0]!.column).toBe("required_later");
    expect(plan[0]!.sqlite).toBeNull();
    expect(plan[0]!.postgres).toBeNull();
    expect(plan[0]!.unsupported).toContain("NOT NULL");
  });

  it("refuses a declared type it does not model rather than guessing one", () => {
    // The rail that matters most. A missing column fails loudly on the next
    // write; a column created at the WRONG type is accepted and mismatches
    // silently until some value does not fit it. A vector column is the live
    // example — pgvector's `vector(n)` is not something to infer.
    const declared = [
      table(
        "t",
        Type.Object({
          id: Type.String(),
          embedding: TypeNullable(Type.String({ format: "TypedArray:Float32Array" })),
        }),
        ["id"]
      ),
    ];
    const plan = planMissingColumns(declared, new Map([["t", new Set(["id"])]]));
    expect(plan).toHaveLength(1);
    expect(plan[0]!.sqlite).toBeNull();
    expect(plan[0]!.postgres).toBeNull();
    expect(plan[0]!.unsupported).toContain("not mapped");
  });

  it("types the live filings column as BOOLEAN / INTEGER", () => {
    const declared = [table("filings", FilingSchema, [...FilingPrimaryKeyNames])];
    const live = new Map([["filings", new Set(COLUMNS_WITHOUT_IT)]]);
    const plan = planMissingColumns(declared, live);
    expect(plan).toEqual([
      {
        table: "filings",
        column: MISSING_COLUMN,
        sqlite: "INTEGER",
        postgres: "BOOLEAN",
        unsupported: null,
      },
    ]);
  });
});
