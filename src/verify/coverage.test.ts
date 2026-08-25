/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { measureCoverage } from "./coverage";
import { buildParseTrace } from "./parseTrace";

const fixtureRoot = join(import.meta.dirname, "../sec/html/mock_data/s1");

describe("measureCoverage", () => {
  it("counts text a block carries as emitted", () => {
    const html = "<html><body><p>Alpha beta gamma</p></body></html>";
    const span = { start: html.indexOf("<p>"), end: html.indexOf("</p>") + 4 };
    const report = measureCoverage(
      html,
      [{ type: "paragraph", source: span, text: "Alpha beta gamma" }],
      []
    );
    expect(report.lostChars).toBe(0);
    expect(report.ratio).toBe(1);
  });

  /**
   * The regression this whole measurement exists for. Block spans nest, so a
   * containment-only test answers "yes, covered" for every character in the
   * filing — the first version of this reported 100.00% over 31.5M characters
   * of the corpus and was measuring nothing.
   */
  it("reports text an enclosing block's span covers but its text does not carry", () => {
    const html =
      "<html><body><table><tr><td>Kept</td><td>Dropped value</td></tr></table></body></html>";
    const span = { start: html.indexOf("<table>"), end: html.indexOf("</table>") + 8 };
    const report = measureCoverage(
      html,
      // A table whose span covers both cells but whose rendered text lost one.
      [{ type: "table", source: span, text: "| Kept |" }],
      []
    );
    expect(report.lostRuns).toBe(1);
    expect(report.worstLost[0]?.text).toBe("Dropped value");
    expect(report.worstLost[0]?.containedBy?.type).toBe("table");
    expect(report.ratio).toBeLessThan(1);
  });

  it("separates de-paginated text from lost text", () => {
    const html = "<html><body><p>Body prose here</p><p>7</p></body></html>";
    const bodySpan = { start: html.indexOf("<p>Body"), end: html.indexOf("</p>") + 4 };
    const pageSpan = { start: html.indexOf("<p>7"), end: html.lastIndexOf("</p>") + 4 };
    const report = measureCoverage(
      html,
      [{ type: "paragraph", source: bodySpan, text: "Body prose here" }],
      [{ type: "dropped:page-number", source: pageSpan, text: "7" }]
    );
    expect(report.lostChars).toBe(0);
    expect(report.depaginatedChars).toBe(1);
    expect(report.emittedChars).toBe("Body prose here".length);
  });

  it("counts text no block reached at all, with no container", () => {
    const html = "<html><body><p>Alpha</p><p>Orphan text</p></body></html>";
    const span = { start: html.indexOf("<p>Alpha"), end: html.indexOf("</p>") + 4 };
    const report = measureCoverage(html, [{ type: "paragraph", source: span, text: "Alpha" }], []);
    expect(report.worstLost[0]?.text).toBe("Orphan text");
    expect(report.worstLost[0]?.containedBy).toBeUndefined();
  });
});

describe("buildParseTrace", () => {
  it("accounts for a document the parser handles completely", () => {
    const html = `<html><body>
      <p style="font-size:14pt;font-weight:bold">RISK FACTORS</p>
      <p>The company may not achieve profitability in any given period.</p>
      <table><tr><th>Class</th><th>Shares</th></tr><tr><td>Class A</td><td>1,000</td></tr></table>
    </body></html>`;
    const trace = buildParseTrace(html, "unit");
    expect(trace.coverage.lostChars).toBe(0);
    expect(trace.blocks.length).toBeGreaterThan(1);
    expect(trace.blocks.every((b) => b.source.end > b.source.start)).toBe(true);
  });

  /**
   * A floor, never an equality.
   *
   * Coverage on this corpus is short of 100% today — colspan two-column tables
   * lose their value column — and the point of the number is to move up. An
   * equality assertion would fail on the fix; a floor fails only on a
   * regression, and is raised deliberately when a fix lands.
   */
  it("holds the measured coverage floor on committed fixtures", () => {
    const floors: ReadonlyArray<readonly [string, number]> = [
      ["s1_1563568_000143774926013504.htm", 0.994],
      ["s1_1849470_000110465921035696.htm", 0.998],
      ["s1_1925283_000162828026027260.htm", 0.966],
    ];
    const below = floors.flatMap(([name, floor]) => {
      const { coverage } = buildParseTrace(readFileSync(join(fixtureRoot, name), "utf8"), name);
      return coverage.ratio >= floor ? [] : [`${name}: ${coverage.ratio.toFixed(4)} < ${floor}`];
    });
    expect(below).toEqual([]);
  });
});
