/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractInlineXbrlRows } from "./extractInlineXbrl";

const FIXTURES = join(import.meta.dirname, "../../sec/xbrl/mock_data");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf-8");
}

describe("extractInlineXbrlRows", () => {
  it("reads the facts a real filing tagged inline", () => {
    const rows = extractInlineXbrlRows({
      html: fixture("exfee_2114227_000121390026039320.htm"),
      accession_number: "0001213900-26-039320",
      cik: 2114227,
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.source === "inline")).toBe(true);
    expect(rows.every((row) => row.accession_number === "0001213900-26-039320")).toBe(true);
    expect(rows.every((row) => row.cik === 2114227)).toBe(true);
    // A fee exhibit's whole point is the numbers on it.
    expect(rows.some((row) => row.is_numeric && row.value_numeric !== null)).toBe(true);
    // `fact_index` is half the primary key, so a duplicate is a silent row loss.
    expect(new Set(rows.map((row) => row.fact_index)).size).toBe(rows.length);
  });

  it("returns nothing for a document with no inline markup, rather than throwing", () => {
    expect(
      extractInlineXbrlRows({
        html: "<html><body><p>A press release with no tagging at all.</p></body></html>",
        accession_number: "0001213900-26-000001",
        cik: 320193,
      })
    ).toEqual([]);
  });

  it("continues the numbering across a submission's documents", () => {
    const html = fixture("exfee_19617_000183988226028863.htm");
    const first = extractInlineXbrlRows({
      html,
      accession_number: "0001839882-26-028863",
      cik: 19617,
    });
    expect(first.length).toBeGreaterThan(0);

    const second = extractInlineXbrlRows({
      html,
      accession_number: "0001839882-26-028863",
      cik: 19617,
      indexOffset: first.length,
    });
    // Disjoint index ranges: two documents of one submission share a table and
    // a primary key, and an offset that did not apply would overwrite the first
    // document's rows with the second's.
    expect(second[0]?.fact_index).toBe(first.length);
    expect(new Set([...first, ...second].map((row) => row.fact_index)).size).toBe(
      first.length + second.length
    );
  });
});
