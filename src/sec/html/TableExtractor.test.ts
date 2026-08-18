/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { extractTable, isLayoutTable } from "./TableExtractor";

function tableFrom(html: string) {
  const $ = cheerio.load(html);
  return extractTable($, $("table").get(0)!);
}

describe("extractTable", () => {
  it("builds a rectangular grid with header detection and numeric typing", () => {
    const t = tableFrom(`
      <table>
        <tr><th>Name</th><th>Shares</th></tr>
        <tr><td>Alice</td><td>1,250</td></tr>
        <tr><td>Bob</td><td>(40)</td></tr>
      </table>`);
    expect(t.columnCount).toBe(2);
    expect(t.headerRows).toHaveLength(1);
    expect(t.headerRows[0][0].text).toBe("Name");
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][1].numeric).toBe(1250);
    expect(t.rows[1][1].numeric).toBe(-40);
    expect(t.stitchedFrom).toBe(1);
    expect(t.text).toContain("| Name | Shares |");
  });

  it("expands colspan and rowspan into a full grid", () => {
    const t = tableFrom(`
      <table>
        <tr><td colspan="2">Wide</td></tr>
        <tr><td rowspan="2">Tall</td><td>A</td></tr>
        <tr><td>B</td></tr>
      </table>`);
    expect(t.columnCount).toBe(2);
    expect(t.rows[0].map((c) => c.text)).toEqual(["Wide", "Wide"]);
    expect(t.rows[1].map((c) => c.text)).toEqual(["Tall", "A"]);
    expect(t.rows[2].map((c) => c.text)).toEqual(["Tall", "B"]); // rowspan filled down
  });

  it("strips all-empty spacer columns", () => {
    const t = tableFrom(`
      <table>
        <tr><td>X</td><td></td><td>Y</td></tr>
        <tr><td>1</td><td></td><td>2</td></tr>
      </table>`);
    expect(t.columnCount).toBe(2);
    expect(t.rows[0].map((c) => c.text)).toEqual(["X", "Y"]);
  });

  it("does not treat a 1-column data table as a layout wrapper", () => {
    const $ = cheerio.load(`<table><tr><th>H</th></tr><tr><td>1</td></tr></table>`);
    expect(isLayoutTable($, $("table").get(0)!)).toBe(false);
  });

  it("treats a 1-column cell with two block children as a layout wrapper", () => {
    const $ = cheerio.load(`
      <table><tr><td>
        <p><b>The Offering</b></p>
        <p>Intro.</p>
      </td></tr></table>`);
    expect(isLayoutTable($, $("table").get(0)!)).toBe(true);
  });
});
