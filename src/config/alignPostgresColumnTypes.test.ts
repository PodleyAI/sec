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
  CanonicalCompanyPhonePrimaryKeyNames,
  CanonicalCompanyPhoneSchema,
  CanonicalPersonPhonePrimaryKeyNames,
  CanonicalPersonPhoneSchema,
} from "../storage/canonical/CanonicalJunctionSchemas";
import {
  CompanyFactsPrimaryKeyNames,
  CompanyFactsSchema,
} from "../storage/facts/CompanyFactsSchema";
import { XbrlFactPrimaryKeyNames, XbrlFactRowSchema } from "../storage/xbrl/XbrlFactSchema";

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
    const plan = planColumnAlignment(declared, [varchar("phones", "international_number", 20)]);
    expect(plan).toEqual([
      {
        table: "phones",
        column: "international_number",
        kind: "widen",
        width: 64,
        sql: 'ALTER TABLE "phones" ALTER COLUMN "international_number" TYPE varchar(64)',
      },
    ]);
  });

  it("is a no-op when the live column is already at the declared width", () => {
    const declared = [table("phones", Type.Object({ n: Type.String({ maxLength: 64 }) }), ["n"])];
    expect(planColumnAlignment(declared, [varchar("phones", "n", 64)])).toEqual([]);
  });

  it("never narrows a column that is already wider than declared", () => {
    const declared = [table("phones", Type.Object({ n: Type.String({ maxLength: 64 }) }), ["n"])];
    expect(planColumnAlignment(declared, [varchar("phones", "n", 128)])).toEqual([]);
    // An unbounded TEXT column has no length at all — also never narrowed.
    expect(planColumnAlignment(declared, [text("phones", "n")])).toEqual([]);
  });

  it("never re-tightens a live-nullable column that the schema declares required", () => {
    const declared = [
      table("t", Type.Object({ id: Type.String(), v: Type.String() }), ["id"]),
      // A PK column is always NOT NULL in the DDL, so a nullable live PK is
      // still never re-tightened.
    ];
    const plan = planColumnAlignment(declared, [text("t", "id", true), text("t", "v", true)]);
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
    const plan = planColumnAlignment(declared, [
      text("addresses", "address_hash_id"),
      text("addresses", "state_or_country"),
    ]);
    expect(plan).toEqual([
      {
        table: "addresses",
        column: "state_or_country",
        kind: "drop-not-null",
        width: undefined,
        sql: 'ALTER TABLE "addresses" ALTER COLUMN "state_or_country" DROP NOT NULL',
      },
    ]);
  });

  it("skips a declared column the live schema does not have yet", () => {
    const declared = [
      table("t", Type.Object({ id: Type.String(), added_later: Type.String({ maxLength: 99 }) }), [
        "id",
      ]),
    ];
    // Only `id` exists live; the new column is created by setupDatabase(), not altered.
    expect(planColumnAlignment(declared, [varchar("t", "id", 10)])).toEqual([]);
  });

  it("returns no width for a nullable enum column (TEXT, only the NOT NULL matters)", () => {
    const declared = [
      table("addresses", AddressSchema, AddressPrimaryKeyNames as ReadonlyArray<string>),
    ];
    const plan = planColumnAlignment(declared, [text("addresses", "state_or_country")]);
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
      table(
        "canonical_person_phone",
        CanonicalPersonPhoneSchema,
        CanonicalPersonPhonePrimaryKeyNames as ReadonlyArray<string>
      ),
      table(
        "canonical_company_phone",
        CanonicalCompanyPhoneSchema,
        CanonicalCompanyPhonePrimaryKeyNames as ReadonlyArray<string>
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
      varchar("canonical_person_phone", "international_number", 20),
      varchar("canonical_company_phone", "international_number", 20),
      // Already nullable live — only the width ever changed on this column.
      varchar("xbrl_fact", "context_ref", 255, true),
    ];

    expect(planColumnAlignment(declared, live).map((s) => `${s.sql};`)).toEqual([
      'ALTER TABLE "addresses" ALTER COLUMN "state_or_country" DROP NOT NULL;',
      'ALTER TABLE "phones" ALTER COLUMN "international_number" TYPE varchar(64);',
      'ALTER TABLE "filings" ALTER COLUMN "form" TYPE varchar(32);',
      'ALTER TABLE "filings" ALTER COLUMN "file_number" TYPE varchar(255);',
      'ALTER TABLE "filings" ALTER COLUMN "film_number" TYPE varchar(255);',
      'ALTER TABLE "filings" ALTER COLUMN "primary_doc" TYPE varchar(128);',
      'ALTER TABLE "filings" ALTER COLUMN "primary_doc_description" TYPE varchar(255);',
      'ALTER TABLE "filings" ALTER COLUMN "act" TYPE varchar(16);',
      'ALTER TABLE "company_facts" ALTER COLUMN "grouping" TYPE varchar(20);',
      'ALTER TABLE "company_facts" ALTER COLUMN "val_unit" TYPE varchar(32);',
      'ALTER TABLE "canonical_person_phone" ALTER COLUMN "international_number" TYPE varchar(64);',
      'ALTER TABLE "canonical_company_phone" ALTER COLUMN "international_number" TYPE varchar(64);',
      'ALTER TABLE "xbrl_fact" ALTER COLUMN "context_ref" TYPE varchar(512);',
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
    expect(planColumnAlignment(declared, aligned)).toEqual([]);
  });
});
