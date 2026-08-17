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

// A large share of EDGAR filings express ALL of their emphasis through the
// `font` shorthand — Inception Growth's 2021 S-1 has 410 shorthand declarations
// and zero `font-weight`. Reading only the longhands made every heading in such
// a filing invisible and left the document unsegmentable.
describe("resolveStyle: the `font` shorthand", () => {
  it("reads weight and size from the real-world EDGAR form", () => {
    const s = styleOf(
      `<p data-t style="font: bold 10pt Times New Roman, Times, Serif; margin: 0pt 0">Management</p>`
    );
    expect(s.bold).toBe(true);
    expect(s.fontSizePt).toBeCloseTo(10, 1);
  });
  it("handles italic, a numeric weight, and a line-height on the size", () => {
    const s = styleOf(`<p data-t style="font: italic 700 12pt/1.4 Arial, sans-serif">x</p>`);
    expect(s.bold).toBe(true);
    expect(s.italic).toBe(true);
    expect(s.fontSizePt).toBeCloseTo(12, 1);
  });
  it("converts non-point sizes just as the longhand does", () => {
    expect(styleOf(`<p data-t style="font: 16px Arial">x</p>`).fontSizePt).toBeCloseTo(12, 1);
  });
  it("resets omitted sub-properties, so it does not inherit an ancestor's bold", () => {
    // Per spec the shorthand sets every sub-property; `font: 10pt Arial` inside
    // a bold parent is NOT bold. Leaving weight undefined would let the
    // ancestor chain fill it in and mark body text as a heading.
    const s = styleOf(
      `<div style="font-weight:700"><p data-t style="font: 10pt Arial">x</p></div>`
    );
    expect(s.bold).toBe(false);
  });
  it("obeys declaration order in both directions", () => {
    // Longhand after shorthand overrides it...
    expect(styleOf(`<p data-t style="font: bold 10pt Arial; font-weight: 400">x</p>`).bold).toBe(
      false
    );
    // ...and shorthand after longhand resets it.
    expect(styleOf(`<p data-t style="font-weight: 700; font: 10pt Arial">x</p>`).bold).toBe(false);
  });
  it("ignores shorthands with no readable size rather than resetting weight off a bad parse", () => {
    // `font: inherit` / system keywords carry no size; treating them as a full
    // shorthand would silently clear an inherited bold.
    const s = styleOf(`<div style="font-weight:700"><p data-t style="font: inherit">x</p></div>`);
    expect(s.bold).toBe(true);
  });
  it("skips variant and stretch keywords that may precede the size", () => {
    const s = styleOf(`<p data-t style="font: small-caps bold condensed 14pt Georgia">x</p>`);
    expect(s.bold).toBe(true);
    expect(s.fontSizePt).toBeCloseTo(14, 1);
  });
});

// Heading rank counts ALL-CAPS as an emphasis trait. Reading that off the source
// text alone ranked a CSS-uppercased heading below a literally-uppercase one, so
// in Constellation's S-1 every real section became a CHILD of the summary's
// offering table and it absorbed 574k characters.
describe("resolveStyle: text-transform", () => {
  it("treats a CSS-uppercased heading as fully upper", () => {
    const s = styleOf(`<p data-t style="text-transform:uppercase">Risk Factors</p>`);
    expect(s.upperRatio).toBeCloseTo(1, 2);
  });
  it("ranks it level with a heading that is literally uppercase", () => {
    const transformed = styleOf(`<p data-t style="text-transform:uppercase">Risk Factors</p>`);
    const literal = styleOf(`<p data-t>THE OFFERING</p>`);
    expect(transformed.upperRatio).toBeCloseTo(literal.upperRatio, 2);
  });
  it("inherits from an ancestor, as CSS does", () => {
    const s = styleOf(`<div style="text-transform:uppercase"><p data-t>Underwriting</p></div>`);
    expect(s.upperRatio).toBeCloseTo(1, 2);
  });
  it("lets a nearer non-uppercase value stop the inheritance", () => {
    const s = styleOf(
      `<div style="text-transform:uppercase"><p data-t style="text-transform:none">Underwriting</p></div>`
    );
    expect(s.upperRatio).toBeLessThan(0.5);
  });
  it("leaves ordinary mixed-case text alone", () => {
    expect(styleOf(`<p data-t>Risk Factors</p>`).upperRatio).toBeLessThan(0.5);
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
