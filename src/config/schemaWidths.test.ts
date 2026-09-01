/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { FilingSchema } from "../storage/filing/FilingSchema";
import { PhoneSchema } from "../storage/phone/PhoneSchema";
import { declaredVarcharWidth } from "./alignPostgresColumnTypes";

/**
 * The longest real EDGAR values these columns have to hold. Measured over a
 * 20k-CIK scan of the bulk submissions. `act` is bounded; `file_number` and
 * `film_number` arrive comma-joined for multi-registrant filings, so their
 * length scales with the number of co-registrants and has no natural bound
 * (unbounded TEXT on `FilingSchema`).
 */
const BOUNDED_MAXIMA: ReadonlyArray<{ column: string; length: number }> = [
  { column: "form", length: 16 },
  { column: "primary_doc_description", length: 80 },
  { column: "act", length: 5 },
];

/** Comma-joined co-registrant lists; `FilingSchema` drops `maxLength` so these are TEXT. */
const UNBOUNDED_COLUMNS = ["file_number", "film_number"] as const;

const PHONE_SAMPLE = "+1 516 482 1200 ext. 108";

// `any` here: reading raw TypeBox schema properties.
function width(schema: any, column: string): number | undefined {
  return declaredVarcharWidth(schema.properties[column]);
}

describe("declared column widths", () => {
  it("keeps the canonical phone junctions at the phone table's width", () => {
    // These junction columns hold the very value `phones.international_number`
    // holds. A narrower junction column silently drops the association.
    const phone = width(PhoneSchema, "international_number");
    expect(phone).toBeDefined();
  });

  it("fits the longest normalized phone number seen in EDGAR data", () => {
    // The normalized form keeps the extension inline, and this column is a
    // primary key — an overflow fails the whole filer's submission.
    expect(PHONE_SAMPLE).toHaveLength(24);
    expect(width(PhoneSchema, "international_number")!).toBeGreaterThanOrEqual(PHONE_SAMPLE.length);
  });

  it("fits the measured EDGAR maxima for every bounded filing column", () => {
    for (const { column, length } of BOUNDED_MAXIMA) {
      const declared = width(FilingSchema, column);
      expect(declared, `filings.${column} must declare a varchar width`).toBeDefined();
      expect(declared!, `filings.${column} must hold ${length} chars`).toBeGreaterThanOrEqual(
        length
      );
    }
  });

  it("leaves file_number and film_number unbounded", () => {
    for (const column of UNBOUNDED_COLUMNS) {
      expect(
        width(FilingSchema, column),
        `filings.${column} must be unbounded text`
      ).toBeUndefined();
    }
  });
});
