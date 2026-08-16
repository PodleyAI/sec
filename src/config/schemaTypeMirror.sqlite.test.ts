/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { Sqlite } from "workglow";
import { getDb } from "../util/db";
import { sqliteColumnType } from "./addMissingColumns";
import type { ObjectSchema } from "./alignPostgresColumnTypes";
import { listRegisteredTables } from "./tableRegistry";
import { withSqliteDb } from "./testing/withSqliteDb";

/**
 * The prerequisite that makes `addMissingColumns` safe to run at all.
 *
 * That pass has to state a column TYPE, so it carries a JSON-Schema → DDL
 * mirror of the storage layer's own emitter. A wrong mirror is worse than the
 * bug it fixes: a missing column fails loudly on the next write, while a column
 * created at the wrong type is accepted and mismatches silently until some
 * value does not fit it. The emitter lives in the `workglow` dependency, so
 * nothing in this repo forces the mirror to stay honest — except this.
 *
 * So: create every registered table from its declared schema on a real SQLite
 * database, read back what the emitter actually wrote, and require the mirror
 * to have predicted it. A type the emitter changes, or a schema keyword the
 * mirror does not model, fails here rather than at 3am inside `db setup`.
 *
 * SQLite only. There is no in-process Postgres to create tables in, and the
 * Postgres half of the mirror is instead pinned statement-by-statement in
 * `addMissingColumns.test.ts` against the emitter source it mirrors.
 */

/**
 * Columns the mirror deliberately declines to type, which the add-column pass
 * therefore skips with a warning rather than guessing at.
 *
 * Kept explicit and kept SMALL: this is the list an operator would have to
 * handle by hand, so adding an unmappable type to a schema must be a decision
 * someone makes here, not a silent no-op discovered later. Format is
 * `table.column`.
 */
const UNMAPPED_COLUMNS: ReadonlySet<string> = new Set<string>([
  // `Type.Array(Type.String())`. The emitter's two backends genuinely disagree
  // about it — SQLite stores JSON in a TEXT column, Postgres emits a real
  // `TEXT[]` — and the array rules branch further on the element type. Left
  // unmapped rather than modelled: `ADD COLUMN` is not where that divergence
  // should be re-derived from memory. Two columns, same shape — Form D
  // exemptions and the Form 1-A securities-offered multi-select.
  "investment_offerings.exemptions",
  "rega_offerings.securities_offered_type",
  // Declared as the union spelling `type: ["string", "null"]` rather than a
  // TypeBox union, which the emitter's `switch (actualType.type)` does not
  // match either — it falls through to its `TEXT /* unknown type */` default.
  // So a mirror returning TEXT here would agree with the emitter by accident,
  // via a fallback that means "I do not recognize this", and would then agree
  // with it for every future unrecognized type too. Skipping is the honest
  // reading: the operator gets a warning naming the column.
  "underwriter_link.role_detail",
]);

/** What SQLite reports as the declared type, once its own tokenizer is done. */
function declaredTypes(table: string): Map<string, string> {
  const rows = getDb()
    .prepare<[], { name: string; type: string }>(`PRAGMA table_info(\`${table}\`)`)
    .all();
  return new Map(rows.map((r) => [r.name, r.type.trim().toUpperCase()]));
}

describe("the SQLite half of the addMissingColumns type mirror", () => {
  // "all" rather than a token list: the point is the shape `db setup` really
  // produces, across every table in the registry rather than a chosen few.
  withSqliteDb("schema_type_mirror_test", "all");

  it("predicts the emitted column type for every registered column", () => {
    const mismatches: string[] = [];
    const unmapped: string[] = [];
    let checked = 0;

    for (const entry of listRegisteredTables()) {
      const live = declaredTypes(entry.table);
      // A table `setupAllDatabases` does not create (a superset's, in another
      // process) has no columns to compare against.
      if (live.size === 0) continue;

      const schema = entry.schema as unknown as ObjectSchema;
      for (const [column, typeDef] of Object.entries(schema.properties ?? {})) {
        const emitted = live.get(column);
        // A declared column the DDL did not emit is a different bug entirely
        // (and one `setupAllDatabases` would already be failing on); not this
        // test's question.
        if (emitted === undefined) continue;

        const predicted = sqliteColumnType(typeDef);
        if (predicted === null) {
          unmapped.push(`${entry.table}.${column}`);
          continue;
        }
        checked += 1;
        // The emitter annotates some types with a trailing comment
        // (`TEXT /* VARCHAR(512) */`). SQLite strips comments while tokenizing,
        // so the stored declared type is the bare keyword either way — which is
        // what makes a plain-keyword mirror correct rather than merely close.
        if (predicted.toUpperCase() !== emitted) {
          mismatches.push(`${entry.table}.${column}: mirror ${predicted}, emitted ${emitted}`);
        }
      }
    }

    expect(mismatches).toEqual([]);
    // Every unmapped column must be a known one. An unrecognized entry here
    // means a schema grew a type the add-column pass cannot create — fix the
    // mirror or add the column to UNMAPPED_COLUMNS on purpose.
    expect(unmapped.filter((c) => !UNMAPPED_COLUMNS.has(c))).toEqual([]);
    // Guard against the whole loop silently covering nothing (an empty
    // registry, or every table missing) and reporting a vacuous pass.
    expect(checked).toBeGreaterThan(500);
  });

  it("emits the bare keyword SQLite stores, not the emitter's annotated form", () => {
    // The one assumption the comparison above rests on, isolated so a change in
    // SQLite's tokenizer would name itself rather than showing up as a hundred
    // mismatches. `filings.form` is declared `maxLength: 32`, which the emitter
    // writes as `TEXT /* VARCHAR(32) */`.
    expect(Sqlite).toBeDefined();
    expect(declaredTypes("filings").get("form")).toBe("TEXT");
  });
});
