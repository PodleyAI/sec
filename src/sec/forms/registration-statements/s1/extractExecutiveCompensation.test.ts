/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  extractExecutiveCompensation,
  isCompensationPositionLabel,
  normalizeFiscalYear,
} from "./sectionExtractors";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function row(over: Record<string, unknown>): Record<string, unknown> {
  return {
    person_name: "Alina Kowalczyk",
    principal_position: "Chief Executive Officer",
    fiscal_year: 2025,
    salary: 612500,
    bonus: 425000,
    stock_awards: null,
    option_awards: 3180400,
    non_equity_incentive: null,
    pension_and_nqdc: null,
    all_other_compensation: 12300,
    total: 4230200,
    footnote: null,
    confidence: 0.9,
    source_span: "| Alina Kowalczyk |  | 2025 |",
    ...over,
  };
}

describe("extractExecutiveCompensation", () => {
  it("returns one row per officer per fiscal year", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        rows: [
          row({}),
          row({ fiscal_year: 2024, salary: 570000, total: 2806800 }),
          row({ person_name: "Bertrand Osei", principal_position: "Chief Operating Officer" }),
        ],
      },
    ]);
    cleanup = unregister;
    const rows = await extractExecutiveCompensation("Summary Compensation Table", fakeS1Model());
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.fiscal_year)).toEqual([2025, 2024, 2025]);
    expect(rows[2].person_name).toBe("Bertrand Osei");
  });

  it("folds the stub column's position line onto the officer above it", async () => {
    // The position is printed on the grid row below the name, and real tables
    // put a second fiscal year's figures on that row. Emitting it as a person
    // would mint a canonical person named after a job title; dropping it would
    // silently lose that fiscal year. It belongs to the officer above.
    const { unregister } = registerFakeStructuredProvider([
      {
        rows: [
          row({}),
          row({ person_name: "Chief Executive Officer", fiscal_year: 2024, salary: 570000 }),
          row({ person_name: "  " }),
        ],
      },
    ]);
    cleanup = unregister;
    const rows = await extractExecutiveCompensation("Summary Compensation Table", fakeS1Model());
    // No canonical person is ever named after a job title …
    expect(rows.map((r) => r.person_name)).toEqual(["Alina Kowalczyk", "Alina Kowalczyk"]);
    // … and the fiscal year that lived on the position row survives with its
    // figures, rather than being dropped along with the label.
    expect(rows.map((r) => r.fiscal_year)).toEqual([2025, 2024]);
    expect(rows[1].salary).toBe(570000);
    expect(rows[1].principal_position).toBe("Chief Executive Officer");
  });

  it("drops a position line carrying no year and no money instead of folding it", async () => {
    // The COMMON layout: every figure sits on the name row and the position row
    // below it holds nothing but the label. Folding it unconditionally emitted a
    // second row per officer — same observation, null fiscal year, all-null
    // money columns — a phantom in a table whose contract is one row per officer
    // per fiscal year.
    const empty = {
      fiscal_year: null,
      salary: null,
      bonus: null,
      stock_awards: null,
      option_awards: null,
      non_equity_incentive: null,
      pension_and_nqdc: null,
      all_other_compensation: null,
      total: null,
    };
    const { unregister } = registerFakeStructuredProvider([
      { rows: [row({}), row({ person_name: "Chief Executive Officer", ...empty })] },
    ]);
    cleanup = unregister;
    const rows = await extractExecutiveCompensation("Summary Compensation Table", fakeS1Model());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ person_name: "Alina Kowalczyk", fiscal_year: 2025 });
  });

  it("still folds a position line whose only datum is a money column", async () => {
    // The guard keys on "carries nothing", not on "has a year" — a position row
    // with a figure but no year is real disclosure and must survive.
    const { unregister } = registerFakeStructuredProvider([
      {
        rows: [
          row({}),
          row({
            person_name: "Chief Executive Officer",
            fiscal_year: null,
            salary: 570000,
            bonus: null,
            stock_awards: null,
            option_awards: null,
            non_equity_incentive: null,
            pension_and_nqdc: null,
            all_other_compensation: null,
            total: null,
          }),
        ],
      },
    ]);
    cleanup = unregister;
    const rows = await extractExecutiveCompensation("Summary Compensation Table", fakeS1Model());
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ person_name: "Alina Kowalczyk", salary: 570000 });
  });

  it("drops a position line with no officer above it to attach to", async () => {
    // Nothing to fold onto, and it must not become a person in its own right.
    const { unregister } = registerFakeStructuredProvider([
      { rows: [row({ person_name: "Chief Financial Officer" }), row({})] },
    ]);
    cleanup = unregister;
    const rows = await extractExecutiveCompensation("Summary Compensation Table", fakeS1Model());
    expect(rows.map((r) => r.person_name)).toEqual(["Alina Kowalczyk"]);
  });

  it("nulls a fiscal year outside the stored column's domain", async () => {
    // A rejected write would dead-letter the whole section, losing every other
    // officer's row with it.
    const { unregister } = registerFakeStructuredProvider([
      { rows: [row({ fiscal_year: 25 }), row({ fiscal_year: 2025.0 })] },
    ]);
    cleanup = unregister;
    const rows = await extractExecutiveCompensation("Summary Compensation Table", fakeS1Model());
    expect(rows.map((r) => r.fiscal_year)).toEqual([null, 2025]);
  });

  it("returns an empty list when the model finds no table", async () => {
    const { unregister } = registerFakeStructuredProvider([{ rows: [] }]);
    cleanup = unregister;
    expect(await extractExecutiveCompensation("nothing here", fakeS1Model())).toEqual([]);
  });
});

describe("isCompensationPositionLabel", () => {
  it("recognizes the position lines a stub column prints under a name", () => {
    for (const label of [
      "Chief Executive Officer",
      "President and Chief Executive Officer",
      "Chairman of the Board",
      "Chief Financial Officer and Secretary",
      "General Counsel",
      "Executive Vice President, Operations",
      "Principal Financial Officer",
      "Interim Chief Executive Officer",
      "Director",
    ]) {
      expect(isCompensationPositionLabel(label), label).toBe(true);
    }
  });

  it("does not reject real officer names", () => {
    for (const name of [
      "Alina Kowalczyk",
      "David Somo",
      "Timothy W. Burns",
      "Kelly T. McKee, MD",
      "Chandra Villanueva",
      // A surname that merely starts with a role-ish word must survive.
      "Presley Vaughn",
      "Chandler Brooks",
    ]) {
      expect(isCompensationPositionLabel(name), name).toBe(false);
    }
  });

  it("is false for a missing name", () => {
    expect(isCompensationPositionLabel(null)).toBe(false);
    expect(isCompensationPositionLabel(undefined)).toBe(false);
  });
});

describe("normalizeFiscalYear", () => {
  it("keeps a plausible year and truncates a decimal", () => {
    expect(normalizeFiscalYear(2025)).toBe(2025);
    expect(normalizeFiscalYear(2025.0)).toBe(2025);
  });

  it("rejects out-of-domain and non-finite values", () => {
    expect(normalizeFiscalYear(25)).toBeNull();
    expect(normalizeFiscalYear(12025)).toBeNull();
    expect(normalizeFiscalYear(Number.NaN)).toBeNull();
    expect(normalizeFiscalYear(null)).toBeNull();
    expect(normalizeFiscalYear(undefined)).toBeNull();
  });
});
