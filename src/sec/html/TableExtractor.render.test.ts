/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a filer's table looks like by the time a model reads it.
 *
 * `TableExtractor.test.ts` asserts the **grid** — `columnCount`, a cell's text,
 * a rowspan filled down. That is not the artifact anything downstream consumes.
 * Extraction is handed `TableNode.text`, the GFM rendering, and for the whole
 * life of this corpus the grid was correct while the rendering deleted the
 * value column of every colspan two-column table. Every property assertion
 * passed throughout.
 *
 * So these pin the rendered markdown, inline, next to the markup that produced
 * it: the failure mode of a snapshot suite is a diff nobody reads, and an
 * external `.snap` file of whole filings is exactly that. Each case is a shape
 * real EDGAR filers emit, cut down to the smallest markup that still produces
 * it.
 *
 * When one of these changes, the diff IS the review — read the table, not the
 * test name, and re-accept only if the new rendering is the better answer.
 */

import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { depaginate } from "./DePaginator";
import { parseToBlocks } from "./parseToBlocks";
import { extractTable, isLayoutTable, leadingOfferingCaption } from "./TableExtractor";

/** Render the first `<table>` in `html` exactly as the extractor would. */
function render(html: string): string {
  const $ = cheerio.load(html);
  return extractTable($, $("table").get(0)!).text;
}

/** Render every table the full walk emits, so de-pagination and stitching apply. */
function renderThroughWalk(html: string): string[] {
  return depaginate(parseToBlocks(html)).flatMap((b) => (b.type === "table" ? [b.node.text] : []));
}

describe("rendered table markdown", () => {
  it("renders a plain header and body", () => {
    expect(
      render(`<table>
        <tr><th>Name</th><th>Shares</th></tr>
        <tr><td>Alice</td><td>1,250</td></tr>
        <tr><td>Bob</td><td>(40)</td></tr>
      </table>`)
    ).toMatchInlineSnapshot(`
      "| Name | Shares |
      | --- | --- |
      | Alice | 1,250 |
      | Bob | (40) |"
    `);
  });

  /**
   * The one that mattered. A prospectus's "The Offering" summary is a label
   * column and a value column built out of colspans, with a leading spacer row
   * of bare `<td>`s establishing the grid width. Under the pre-0.4.3 renderer
   * this produced the label six times and dropped the value entirely.
   */
  it("renders a colspan label/value row with its value column intact", () => {
    expect(
      render(`<table>
        <tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        <tr>
          <td colspan="3">Trust account</td>
          <td colspan="3"></td>
          <td colspan="3">$200,000,000 will be placed in the trust account.</td>
        </tr>
        <tr>
          <td colspan="3">Trading symbol</td>
          <td colspan="3"></td>
          <td colspan="3">We intend to apply to list the units as &#8220;ACQU&#8221;.</td>
        </tr>
      </table>`)
    ).toMatchInlineSnapshot(`
      "|  |  |  |  |  |  |
      | --- | --- | --- | --- | --- | --- |
      |  |  |  |  |  |  |
      | Trust account | Trust account | Trust account | $200,000,000 will be placed in the trust account. | $200,000,000 will be placed in the trust account. | $200,000,000 will be placed in the trust account. |
      | Trading symbol | Trading symbol | Trading symbol | We intend to apply to list the units as “ACQU”. | We intend to apply to list the units as “ACQU”. | We intend to apply to list the units as “ACQU”. |"
    `);
  });

  it("fills a rowspan down every row it covers", () => {
    expect(
      render(`<table>
        <tr><th>Holder</th><th>Class</th><th>Shares</th></tr>
        <tr><td rowspan="2">Sponsor LLC</td><td>Class B</td><td>5,750,000</td></tr>
        <tr><td>Class A</td><td>100,000</td></tr>
      </table>`)
    ).toMatchInlineSnapshot(`
      "| Holder | Class | Shares |
      | --- | --- | --- |
      | Sponsor LLC | Class B | 5,750,000 |
      | Sponsor LLC | Class A | 100,000 |"
    `);
  });

  it("drops spacer columns that are empty in every row", () => {
    expect(
      render(`<table>
        <tr><td>Public shares</td><td></td><td>20,000,000</td><td></td><td>$10.00</td></tr>
        <tr><td>Founder shares</td><td></td><td>5,000,000</td><td></td><td>$0.004</td></tr>
      </table>`)
    ).toMatchInlineSnapshot(`
      "|  |  |  |
      | --- | --- | --- |
      | Public shares | 20,000,000 | $10.00 |
      | Founder shares | 5,000,000 | $0.004 |"
    `);
  });

  /**
   * Only LEADING all-`th` rows are header rows, and only the first renders as
   * the GFM header — the rest render as body rows so no data is lost. A `th`
   * appearing after a body row is a mid-table restatement, not a header.
   */
  it("renders trailing header rows as body rows", () => {
    expect(
      render(`<table>
        <tr><th></th><th>2025</th><th>2024</th></tr>
        <tr><th>(in thousands)</th><th>(audited)</th><th>(audited)</th></tr>
        <tr><td>Revenue</td><td>1,000</td><td>900</td></tr>
        <tr><th>Total</th><td>1,000</td><td>900</td></tr>
      </table>`)
    ).toMatchInlineSnapshot(`
      "|  | 2025 | 2024 |
      | --- | --- | --- |
      | (in thousands) | (audited) | (audited) |
      | Revenue | 1,000 | 900 |
      | Total | 1,000 | 900 |"
    `);
  });

  /**
   * Most real EDGAR tables mark no cell as `<th>`, so the renderer emits an
   * empty header row above the separator. It is ugly and it is load-bearing:
   * GFM has no table without a header, and dropping the row would promote the
   * first data row into one.
   */
  it("renders an empty header when the filer marked no header cells", () => {
    expect(
      render(`<table>
        <tr><td>Units offered</td><td>20,000,000</td></tr>
        <tr><td>Price per unit</td><td>$10.00</td></tr>
      </table>`)
    ).toMatchInlineSnapshot(`
      "|  |  |
      | --- | --- |
      | Units offered | 20,000,000 |
      | Price per unit | $10.00 |"
    `);
  });

  /** A literal pipe would end the cell early; a newline would end the row. */
  it("escapes pipes and newlines inside a cell", () => {
    expect(
      render(`<table>
        <tr><td>Class A | Class B</td><td>Two
        lines</td></tr>
      </table>`)
    ).toMatchInlineSnapshot(`
      "|  |  |
      | --- | --- |
      | Class A \\| Class B | Two lines |"
    `);
  });

  /** A row with fewer cells than the grid is padded, never left ragged. */
  it("pads a short row out to the column count", () => {
    expect(
      render(`<table>
        <tr><th>Holder</th><th>Shares</th><th>Percent</th></tr>
        <tr><td>All officers as a group</td></tr>
      </table>`)
    ).toMatchInlineSnapshot(`
      "| Holder | Shares | Percent |
      | --- | --- | --- |
      | All officers as a group |  |  |"
    `);
  });

  it("renders a table split across a page break as one table", () => {
    expect(
      renderThroughWalk(`<html><body>
        <table>
          <tr><th>Holder</th><th>Shares</th></tr>
          <tr><td>Sponsor LLC</td><td>5,750,000</td></tr>
        </table>
        <hr style="page-break-after:always" />
        <table>
          <tr><th>Holder</th><th>Shares</th></tr>
          <tr><td>Anchor Investor</td><td>1,000,000</td></tr>
        </table>
      </body></html>`)
    ).toMatchInlineSnapshot(`
      [
        "| Holder | Shares |
      | --- | --- |
      | Sponsor LLC | 5,750,000 |
      | Anchor Investor | 1,000,000 |",
      ]
    `);
  });
});

describe("what is not rendered as a table", () => {
  /**
   * A one-column cell holding two block children is a typesetter's wrapper, not
   * a grid. The walk descends into it instead, so the heading inside can become
   * a heading node — which is what lets the segmenter find the section at all.
   */
  it("treats a one-column multi-block cell as layout, not a table", () => {
    const $ = cheerio.load(`<table><tr><td>
      <p><b>THE OFFERING</b></p>
      <p>The following summarizes the offering.</p>
    </td></tr></table>`);
    expect(isLayoutTable($, $("table").get(0)!)).toBe(true);
  });

  it("peels a full-width offering caption off the top of a data table", () => {
    const $ = cheerio.load(`<table>
      <tr><td colspan="2"><b>The Offering</b></td></tr>
      <tr><td>Units offered</td><td>20,000,000</td></tr>
    </table>`);
    const table = $("table").get(0)!;
    const caption = leadingOfferingCaption($, table);
    expect(caption).toBeDefined();
    // The caption row is removed before extraction, so the rendered table is
    // the data alone and the caption survives as prose the segmenter can match.
    $(caption!.row as never).remove();
    expect(extractTable($, table).text).toMatchInlineSnapshot(`
      "|  |  |
      | --- | --- |
      | Units offered | 20,000,000 |"
    `);
  });
});
