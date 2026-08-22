/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { buildCompareTable, type CompareResult, type CompareRun } from "./compare";

function run(model: string, rows: readonly unknown[]): CompareRun {
  return { model, ok: true, error: "", latencyMs: 100, rows, usd: null, agreement: undefined };
}

function result(extractor: string, runs: readonly CompareRun[]): CompareResult {
  return {
    cik: 1,
    accessionNumber: "0000000000-25-000001",
    extractor,
    sectionName: "Management",
    sectionChars: 10,
    sectionText: "x",
    prompt: "p",
    instructions: "i",
    schema: "{}",
    nonceEnabled: false,
    runs,
    error: "",
  };
}

describe("buildCompareTable", () => {
  it("aligns rows on the extractor's key field and marks a model that dropped one", () => {
    const table = buildCompareTable(
      result("management", [
        run("a", [
          { full_name: "Jane Doe", titles: ["CEO"] },
          { full_name: "John Roe", titles: ["CFO"] },
        ]),
        run("b", [{ full_name: "Jane Doe", titles: ["CEO"] }]),
      ])
    );
    expect(table.keyField).toBe("full_name");
    expect(table.rows.map((r) => r.key)).toEqual(["Jane Doe", "John Roe"]);
    // A dropped entity is the failure a side-by-side table exists to make
    // visible — as a gap in a column, not an absence to be spotted by eye.
    const dropped = table.rows[1]!;
    expect(dropped.cells.map((c) => c.present)).toEqual([true, false]);
    expect(dropped.agree).toBe(false);
    expect(table.disagreements).toBe(1);
  });

  it("marks a row where the models disagree on a compared field", () => {
    const table = buildCompareTable(
      result("management", [
        run("a", [{ full_name: "Jane Doe", titles: ["CEO"] }]),
        run("b", [{ full_name: "Jane Doe", titles: ["Chief Executive Officer"] }]),
      ])
    );
    expect(table.rows[0]!.agree).toBe(false);
    expect(table.rows[0]!.cells[0]!.values).toEqual(["Jane Doe", "CEO"]);
    expect(table.rows[0]!.cells[1]!.values).toEqual(["Jane Doe", "Chief Executive Officer"]);
  });

  it("agrees when every model produced the same values", () => {
    const table = buildCompareTable(
      result("management", [
        run("a", [{ full_name: "Jane Doe", titles: ["CEO"] }]),
        run("b", [{ full_name: "Jane Doe", titles: ["CEO"] }]),
      ])
    );
    expect(table.rows[0]!.agree).toBe(true);
    expect(table.disagreements).toBe(0);
  });

  it("aligns positionally for an extractor that declares no key field", () => {
    // `offering-terms` is a single-object extractor: there is no field that
    // identifies a row, so alignment is by position — the same rule the scorer
    // applies.
    const table = buildCompareTable(
      result("offering-terms", [
        run("a", [{ price_per_unit: 10 }]),
        run("b", [{ price_per_unit: 10.5 }]),
      ])
    );
    expect(table.keyField).toBeUndefined();
    expect(table.rows.map((r) => r.key)).toEqual(["#1"]);
    expect(table.rows[0]!.agree).toBe(false);
  });

  it("omits a failed model from the columns rather than showing it as empty", () => {
    const failed: CompareRun = {
      model: "b",
      ok: false,
      error: "boom",
      latencyMs: 0,
      rows: [],
      usd: null,
      agreement: undefined,
    };
    const table = buildCompareTable(
      result("management", [run("a", [{ full_name: "Jane Doe", titles: ["CEO"] }]), failed])
    );
    // A model that never answered has no opinion; a column of blanks would read
    // as "it dropped every entity".
    expect(table.models).toEqual(["a"]);
    expect(table.rows[0]!.agree).toBe(true);
  });

  it("returns an empty table when nothing succeeded", () => {
    const table = buildCompareTable(result("management", []));
    expect(table.models).toEqual([]);
    expect(table.rows).toEqual([]);
  });
});
