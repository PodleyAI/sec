/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { planColumnAlignment, type LiveColumn } from "./alignPostgresColumnTypes";
import type { RegisteredTable } from "./tableRegistry";
import { TypeNullable } from "../util/TypeBoxUtil";
import { AddressPrimaryKeyNames, AddressSchema } from "../storage/address/AddressSchema";
import { FilingPrimaryKeyNames, FilingSchema } from "../storage/filing/FilingSchema";
import { PhonePrimaryKeyNames, PhoneSchema } from "../storage/phone/PhoneSchema";
import {
  CompanyFactsPrimaryKeyNames,
  CompanyFactsSchema,
} from "../storage/facts/CompanyFactsSchema";
import { XbrlFactPrimaryKeyNames, XbrlFactRowSchema } from "../storage/xbrl/XbrlFactSchema";

/**
 * The schema every planned statement is qualified with. Ordinary lower-case,
 * because these tests are about the widening RULES; the qualification itself —
 * and the `quote()` that keeps it correct for a mixed-case schema — is pinned
 * in `addMissingColumns.postgres.test.ts`, which shares the same helper.
 */
const SCHEMA = "public";

function table(
  name: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixtures pass raw TypeBox schemas
  schema: any,
  primaryKeyNames: ReadonlyArray<string>
): RegisteredTable {
  return { table: name, schema, primaryKeyNames };
}

function varchar(t: string, column: string, length: number, nullable = false): LiveColumn {
  return { table: t, column, characterMaximumLength: length, isNullable: nullable };
}

function text(t: string, column: string, nullable = false): LiveColumn {
  return { table: t, column, characterMaximumLength: null, isNullable: nullable };
}

describe("planColumnAlignment", () => {
  it("widens a primary-key varchar that the declared schema outgrew", () => {
    const declared = [
      table("phones", Type.Object({ international_number: Type.String({ maxLength: 64 }) }), [
        "international_number",
      ]),
    ];
    const plan = planColumnAlignment(
      declared,
      [varchar("phones", "international_number", 20)],
      SCHEMA
    );
    expect(plan).toEqual([
      {
        table: "phones",
        column: "international_number",
        kind: "widen",
        width: 64,
        sql: 'ALTER TABLE "public"."phones" ALTER COLUMN "international_number" TYPE varchar(64)',
      },
    ]);
  });

  it("is a no-op when the live column is already at the declared width", () => {
    const declared = [table("phones", Type.Object({ n: Type.String({ maxLength: 64 }) }), ["n"])];
    expect(planColumnAlignment(declared, [varchar("phones", "n", 64)], SCHEMA)).toEqual([]);
  });

  it("never narrows a column that is already wider than declared", () => {
    const declared = [table("phones", Type.Object({ n: Type.String({ maxLength: 64 }) }), ["n"])];
    expect(planColumnAlignment(declared, [varchar("phones", "n", 128)], SCHEMA)).toEqual([]);
    // An unbounded TEXT column has no length at all — also never narrowed.
    expect(planColumnAlignment(declared, [text("phones", "n")], SCHEMA)).toEqual([]);
  });

  it("never re-tightens a live-nullable column that the schema declares required", () => {
    const declared = [
      table("t", Type.Object({ id: Type.String(), v: Type.String() }), ["id"]),
      // A PK column is always NOT NULL in the DDL, so a nullable live PK is
      // still never re-tightened.
    ];
    const plan = planColumnAlignment(
      declared,
      [text("t", "id", true), text("t", "v", true)],
      SCHEMA
    );
    expect(plan).toEqual([]);
  });

  it("relaxes NOT NULL on a TEXT column the schema declares nullable", () => {
    const declared = [
      table(
        "addresses",
        Type.Object({
          address_hash_id: Type.String(),
          state_or_country: TypeNullable(Type.String()),
        }),
        ["address_hash_id"]
      ),
    ];
    const plan = planColumnAlignment(
      declared,
      [text("addresses", "address_hash_id"), text("addresses", "state_or_country")],
      SCHEMA
    );
    expect(plan).toEqual([
      {
        table: "addresses",
        column: "state_or_country",
        kind: "drop-not-null",
        width: undefined,
        sql: 'ALTER TABLE "public"."addresses" ALTER COLUMN "state_or_country" DROP NOT NULL',
      },
    ]);
  });

  it("unbinds a live varchar whose schema dropped its maxLength", () => {
    // Same overflow the widening branch fixes: the declared type is now
    // unbounded TEXT, so there is no width to compare against and the column
    // would otherwise keep rejecting values the schema allows.
    const declared = [table("t", Type.Object({ id: Type.String(), v: Type.String() }), ["id"])];
    const plan = planColumnAlignment(declared, [text("t", "id"), varchar("t", "v", 20)], SCHEMA);
    expect(plan).toEqual([
      {
        table: "t",
        column: "v",
        kind: "unbound",
        width: undefined,
        sql: 'ALTER TABLE "public"."t" ALTER COLUMN "v" TYPE text',
      },
    ]);
    // Idempotent: nothing left to do once the column is already text.
    expect(planColumnAlignment(declared, [text("t", "id"), text("t", "v")], SCHEMA)).toEqual([]);
  });

  it("treats a null branch on `oneOf` as nullable, like the DDL does", () => {
    const declared = [
      table(
        "t",
        {
          type: "object",
          properties: {
            id: { type: "string" },
            v: { oneOf: [{ type: "string" }, { type: "null" }] },
          },
          required: ["id", "v"],
        },
        ["id"]
      ),
    ];
    const plan = planColumnAlignment(declared, [text("t", "id"), text("t", "v")], SCHEMA);
    expect(plan.map((s) => s.kind)).toEqual(["drop-not-null"]);
  });

  it("skips a declared column the live schema does not have yet", () => {
    const declared = [
      table(
        "t",
        Type.Object({
          id: Type.String({ maxLength: 10 }),
          added_later: Type.String({ maxLength: 99 }),
        }),
        ["id"]
      ),
    ];
    // Only `id` exists live (and already at its declared width); the new column
    // is created by setupDatabase(), not altered.
    expect(planColumnAlignment(declared, [varchar("t", "id", 10)], SCHEMA)).toEqual([]);
  });

  it("returns no width for a nullable enum column (TEXT, only the NOT NULL matters)", () => {
    const declared = [
      table("addresses", AddressSchema, AddressPrimaryKeyNames as ReadonlyArray<string>),
    ];
    const plan = planColumnAlignment(declared, [text("addresses", "state_or_country")], SCHEMA);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.kind).toBe("drop-not-null");
    expect(plan[0]!.width).toBeUndefined();
  });

  it("emits exactly the widening/relaxing DDL a pre-widening database needs", () => {
    const declared: RegisteredTable[] = [
      table("addresses", AddressSchema, AddressPrimaryKeyNames as ReadonlyArray<string>),
      table("phones", PhoneSchema, PhonePrimaryKeyNames as ReadonlyArray<string>),
      table("filings", FilingSchema, FilingPrimaryKeyNames as ReadonlyArray<string>),
      table(
        "company_facts",
        CompanyFactsSchema,
        CompanyFactsPrimaryKeyNames as ReadonlyArray<string>
      ),
      table("xbrl_fact", XbrlFactRowSchema, XbrlFactPrimaryKeyNames as ReadonlyArray<string>),
    ];

    // The live shape a database created before the widening still has.
    const live: LiveColumn[] = [
      text("addresses", "state_or_country"),
      varchar("phones", "international_number", 20),
      varchar("filings", "form", 8, true),
      varchar("filings", "file_number", 10, true),
      varchar("filings", "film_number", 10, true),
      varchar("filings", "primary_doc", 45),
      varchar("filings", "primary_doc_description", 45, true),
      varchar("filings", "act", 2, true),
      varchar("company_facts", "grouping", 10),
      varchar("company_facts", "val_unit", 20),
      // Already nullable live — only the width ever changed on this column.
      varchar("xbrl_fact", "context_ref", 255, true),
    ];

    expect(planColumnAlignment(declared, live, SCHEMA).map((s) => `${s.sql};`)).toEqual([
      'ALTER TABLE "public"."addresses" ALTER COLUMN "state_or_country" DROP NOT NULL;',
      'ALTER TABLE "public"."phones" ALTER COLUMN "international_number" TYPE varchar(64);',
      'ALTER TABLE "public"."filings" ALTER COLUMN "form" TYPE varchar(32);',
      'ALTER TABLE "public"."filings" ALTER COLUMN "file_number" TYPE text;',
      'ALTER TABLE "public"."filings" ALTER COLUMN "film_number" TYPE text;',
      'ALTER TABLE "public"."filings" ALTER COLUMN "primary_doc" TYPE varchar(128);',
      // Both halves for one column: `primary_doc` was widened AND relaxed, and
      // a legacy database needs each. This is the whole reason the relaxation
      // ships without a bespoke migration — `db setup` reaches Postgres on its
      // own (a pre-existing SQLite file keeps the NOT NULL, and so keeps
      // today's behavior).
      'ALTER TABLE "public"."filings" ALTER COLUMN "primary_doc" DROP NOT NULL;',
      'ALTER TABLE "public"."filings" ALTER COLUMN "primary_doc_description" TYPE varchar(255);',
      'ALTER TABLE "public"."filings" ALTER COLUMN "act" TYPE varchar(16);',
      'ALTER TABLE "public"."company_facts" ALTER COLUMN "grouping" TYPE varchar(20);',
      'ALTER TABLE "public"."company_facts" ALTER COLUMN "val_unit" TYPE varchar(32);',
      'ALTER TABLE "public"."xbrl_fact" ALTER COLUMN "context_ref" TYPE varchar(512);',
    ]);
  });

  it("quotes the schema it qualifies with, so a mixed-case one survives", () => {
    // Postgres folds an unquoted identifier to lower case, so a statement built
    // as `ALTER TABLE Staging.t ...` reaches `staging` — a schema that may not
    // exist, or worse, may. The catalog these plans are computed from is read
    // `WHERE table_schema = current_schema()`, so an ALTER landing anywhere else
    // is altering a table nothing measured.
    const declared = [table("t", Type.Object({ id: Type.String({ maxLength: 20 }) }), ["id"])];
    const plan = planColumnAlignment(declared, [varchar("t", "id", 10)], "Staging");
    expect(plan.map((s) => s.sql)).toEqual([
      'ALTER TABLE "Staging"."t" ALTER COLUMN "id" TYPE varchar(20)',
    ]);
  });

  it("is idempotent — re-planning against the aligned shape yields nothing", () => {
    const declared = [
      table("phones", PhoneSchema, PhonePrimaryKeyNames as ReadonlyArray<string>),
      table("addresses", AddressSchema, AddressPrimaryKeyNames as ReadonlyArray<string>),
    ];
    const aligned: LiveColumn[] = [
      varchar("phones", "international_number", 64),
      text("addresses", "state_or_country", true),
    ];
    expect(planColumnAlignment(declared, aligned, SCHEMA)).toEqual([]);
  });
});
