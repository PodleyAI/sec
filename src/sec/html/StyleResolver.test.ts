/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { emphasisTraitCount, resolveStyle } from "./StyleResolver";

function styleOf(html: string) {
  const $ = cheerio.load(html);
  const el = $("[data-t]").get(0)!;
  return resolveStyle($, el);
}

describe("resolveStyle", () => {
  it("reads bold, centered, font-size from inline style", () => {
    const s = styleOf(
      `<p data-t style="font-weight:700;text-align:center;font-size:14pt">HELLO</p>`
    );
    expect(s.bold).toBe(true);
    expect(s.centered).toBe(true);
    expect(s.fontSizePt).toBeCloseTo(14, 1);
    expect(s.upperRatio).toBeCloseTo(1, 2);
  });
  it("reads centering from the legacy ALIGN attribute (pre-CSS EDGAR markup)", () => {
    const s = styleOf(`<p data-t align="center"><b>The Offering</b></p>`);
    expect(s.centered).toBe(true);
    expect(s.bold).toBe(true);
  });
  it("CSS text-align wins over the ALIGN attribute; ALIGN=left is not centered", () => {
    expect(styleOf(`<p data-t align="center" style="text-align:left">x</p>`).centered).toBe(false);
    expect(styleOf(`<h5 data-t align="left">Table of Contents</h5>`).centered).toBe(false);
  });
  it("inherits parent style, child wins", () => {
    const s = styleOf(
      `<div style="font-weight:700"><span data-t style="font-weight:400">x</span></div>`
    );
    expect(s.bold).toBe(false); // child override
  });
  it("converts px to pt and treats <b> as bold", () => {
    const s = styleOf(`<b data-t style="font-size:16px">Hi</b>`);
    expect(s.bold).toBe(true);
    expect(s.fontSizePt).toBeCloseTo(12, 0); // 16px * 0.75
  });
});

describe("emphasisTraitCount", () => {
  it("counts independent emphasis signals", () => {
    expect(
      emphasisTraitCount({
        fontSizePt: 14,
        bold: true,
        italic: false,
        underline: false,
        centered: true,
        upperRatio: 0.9,
      })
    ).toBeGreaterThanOrEqual(2);
    expect(
      emphasisTraitCount({
        fontSizePt: 10,
        bold: false,
        italic: false,
        underline: false,
        centered: false,
        upperRatio: 0.1,
      })
    ).toBe(0);
  });
});
