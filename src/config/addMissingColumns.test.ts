/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { Type } from "typebox";
import { addMissingColumnsSqlite, planMissingColumns } from "./addMissingColumns";
import type { RegisteredTable } from "./tableRegistry";
import { withSqliteDb } from "./testing/withSqliteDb";
import { getDb } from "../util/db";
import {
  SPAC_CANDIDATE_REPOSITORY_TOKEN,
  SpacCandidateSchema,
  SpacCandidatePrimaryKeyNames,
  type SpacCandidate,
} from "../storage/spac/SpacCandidateSchema";
import { TypeNullable } from "../util/TypeBoxUtil";

/**
 * The live bug this pass exists for.
 *
 * `spac_candidate.signal_filed_sic_6770` was added to the schema after most
 * databases had already been created. `CREATE TABLE IF NOT EXISTS` is a no-op
 * on an existing table, `createStorage` passes no `tabularMigrations`, and
 * `planColumnAlignment` explicitly skips a column the live schema lacks — so
 * nothing added it, and `IdentifySpacsTask` writes full rows through `putBulk`.
 * `sec update spacs` therefore failed on every pre-existing database.
 */
const MISSING_COLUMN = "signal_filed_sic_6770";

/** The `spac_candidate` column list as it stood before that column was added. */
const LEGACY_COLUMNS = Object.keys(SpacCandidateSchema.properties).filter(
  (c) => c !== MISSING_COLUMN
);

function liveColumnNames(table: string): string[] {
  return getDb()
    .prepare<[], { name: string }>(`PRAGMA table_info(\`${table}\`)`)
    .all()
    .map((r) => r.name);
}

/**
 * Rebuilds `spac_candidate` without the new column, i.e. the shape a database
 * created before it has.
 *
 * DROP + re-CREATE rather than `ALTER TABLE ... DROP COLUMN`: it is the more
 * faithful simulation (this is literally the DDL the old emitter produced) and
 * it does not depend on the bundled SQLite being ≥ 3.35.
 */
function recreateWithoutNewColumn(): void {
  const db = getDb();
  const columns = LEGACY_COLUMNS.map((c) =>
    c === "cik" ? `\`${c}\` INTEGER NOT NULL` : `\`${c}\` TEXT NULL`
  ).join(", ");
  db.exec(`DROP TABLE \`spac_candidate\``);
  db.exec(`CREATE TABLE \`spac_candidate\` (${columns}, PRIMARY KEY (\`cik\`))`);
}

function candidateRow(): SpacCandidate {
  return {
    cik: 1234567,
    name: "Example Acquisition Corp",
    current_sic: 6770,
    signal_sic_6770: true,
    signal_filed_sic_6770: null,
    signal_name_match: true,
    signal_renamed_from: null,
    first_reg_form: "S-1",
    first_reg_date: "2024-01-15",
    reg_while_spac_named: true,
    confidence: "high",
    identified_at: "2026-08-15T00:00:00.000Z",
  };
}

describe("addMissingColumnsSqlite (real SQLite)", () => {
  // "all" so the table is created by exactly the DDL `db setup` emits, rather
  // than by a hand-written CREATE this test would then be testing against
  // itself.
  withSqliteDb("add_missing_columns_test", "all");

  it("adds a column an existing database lacks, and unbreaks the write", async () => {
    const repo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    recreateWithoutNewColumn();

    // Two assertions, and the second is the one that matters: the DDL being
    // absent is a symptom, `putBulk` throwing is the user-visible bug. A test
    // that only checked PRAGMA would still pass if the pass added the column
    // under a name or type the repository cannot write through.
    expect(liveColumnNames("spac_candidate")).not.toContain(MISSING_COLUMN);
    await expect(repo.putBulk([candidateRow()])).rejects.toThrow();

    addMissingColumnsSqlite(getDb());

    expect(liveColumnNames("spac_candidate")).toContain(MISSING_COLUMN);
    await expect(repo.putBulk([candidateRow()])).resolves.not.toThrow();
  });

  it("round-trips null, true and false through the added boolean column", async () => {
    // SQLite has no BOOLEAN type — a boolean lives in an INTEGER-affinity
    // column — so this is exactly where a wrong type mapping shows up: a column
    // created as TEXT would store "true"/"false" strings and read back
    // something the repository's `sqlToJsValue` does not turn into a boolean.
    // The tri-state matters too: `signal_filed_sic_6770` is nullable on
    // purpose, since "no registration parsed yet" is not the same as "false".
    const repo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    recreateWithoutNewColumn();
    addMissingColumnsSqlite(getDb());

    await repo.putBulk([
      { ...candidateRow(), cik: 1, signal_filed_sic_6770: null },
      { ...candidateRow(), cik: 2, signal_filed_sic_6770: true },
      { ...candidateRow(), cik: 3, signal_filed_sic_6770: false },
    ]);

    expect((await repo.get({ cik: 1 }))?.signal_filed_sic_6770).toBeNull();
    expect((await repo.get({ cik: 2 }))?.signal_filed_sic_6770).toBe(true);
    expect((await repo.get({ cik: 3 }))?.signal_filed_sic_6770).toBe(false);
  });

  it("is idempotent — a second run adds nothing and throws nothing", () => {
    // `db setup` is run repeatedly, and on an already-current database this
    // pass must be silent. A second `ADD COLUMN` for the same name is an error
    // in SQLite, so a planner that did not re-read the live columns would warn
    // on every subsequent setup.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recreateWithoutNewColumn();

    addMissingColumnsSqlite(getDb());
    const after = liveColumnNames("spac_candidate");
    addMissingColumnsSqlite(getDb());

    expect(liveColumnNames("spac_candidate")).toEqual(after);
    expect(warn).not.toHaveBeenCalled();
  });

  it("adds nothing at all to a database db setup just created", () => {
    // The fresh-database case: `setupAllDatabases` already emitted the current
    // shape, so the whole registry must plan empty. This is what makes the pass
    // safe to run unconditionally on every `db setup` — including the very
    // first one.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = liveColumnNames("spac_candidate");

    addMissingColumnsSqlite(getDb());

    expect(liveColumnNames("spac_candidate")).toEqual(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it("subsumes the hand-written spac.current_trust_* pass it replaced", async () => {
    // Those three columns had a bespoke `ensureSpacCurrentTrustColumns*` pair,
    // deleted in favour of this pass. They are all nullable, so the generic
    // planner reaches them — asserted here rather than assumed, because the
    // deletion is only safe if it does.
    const db = getDb();
    for (const table of ["spac", "spac_history"]) {
      for (const column of ["current_trust_amount", "current_trust_as_of", "current_trust_filed"]) {
        db.exec(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
      }
    }

    addMissingColumnsSqlite(db);

    for (const table of ["spac", "spac_history"]) {
      const live = liveColumnNames(table);
      expect(live).toContain("current_trust_amount");
      expect(live).toContain("current_trust_as_of");
      expect(live).toContain("current_trust_filed");
    }
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

  it("types the live spac_candidate column as BOOLEAN / INTEGER", () => {
    const declared = [
      table("spac_candidate", SpacCandidateSchema, [...SpacCandidatePrimaryKeyNames]),
    ];
    const live = new Map([["spac_candidate", new Set(LEGACY_COLUMNS)]]);
    const plan = planMissingColumns(declared, live);
    expect(plan).toEqual([
      {
        table: "spac_candidate",
        column: MISSING_COLUMN,
        sqlite: "INTEGER",
        postgres: "BOOLEAN",
        unsupported: null,
      },
    ]);
  });
});
