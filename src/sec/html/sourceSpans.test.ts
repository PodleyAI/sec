/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decode } from "html-entities";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "workglow";
import { depaginateWithTrace } from "./DePaginator";
import { parseEdgarHtml, parseEdgarHtmlWithTrace } from "./parseEdgarHtml";
import { parseToBlocks } from "./parseToBlocks";
import type { EdgarBlock } from "./types";

/**
 * Three real filings rather than the whole corpus: the properties here are
 * structural, so they either hold for every block of a filing or fail on the
 * first, and the golden suite is already slow enough that sweeping 45 documents
 * to re-learn that would cost minutes to say nothing new.
 */
const FIXTURES = [
  "s1_1563568_000143774926013504.htm",
  "s1_1849470_000110465921035696.htm",
  "s1_2087989_000143774926019444.htm",
] as const;

const fixtureRoot = join(import.meta.dirname, "mock_data", "s1");

function blockText(b: EdgarBlock): string {
  return b.type === "heading" ? b.text : b.type === "page-break" ? "" : b.node.text;
}

/**
 * Letters and digits only, lower-cased.
 *
 * A span points at raw markup, so comparing it to a block's text means undoing
 * every difference the walk introduced: entities decoded, inline tags removed
 * (`Houston<span>,</span> TX` reads as one word to a reader and two to a tag
 * stripper), and coalesced paragraphs joined with blank lines the source never
 * had. Dropping punctuation and whitespace entirely sidesteps all of it while
 * staying decisive — 40 alphanumerics do not line up by accident.
 */
function alphanumeric(s: string): string {
  return decode(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Alphanumeric content of a raw HTML slice, tags removed. */
function sliceText(html: string, start: number, end: number): string {
  return alphanumeric(html.slice(start, end).replace(/<[^>]*>/g, " "));
}

describe("EdgarBlock source spans", () => {
  for (const name of FIXTURES) {
    describe(name, () => {
      const html = readFileSync(join(fixtureRoot, name), "utf8");
      const { doc, blocks } = parseEdgarHtmlWithTrace(html, name);

      it("locates every block inside the filing HTML", () => {
        const bad = blocks.filter(
          (b) => b.source.end <= b.source.start || b.source.end > html.length
        );
        expect(bad.map((b) => `${b.type} ${b.source.start}..${b.source.end}`)).toEqual([]);
      });

      it("emits spans in document order", () => {
        const starts = blocks.map((b) => b.source.start);
        expect(starts).toEqual([...starts].sort((a, b) => a - b));
      });

      it("points each block at HTML that contains its text", () => {
        // Coalesced prose joins several DOM nodes, so compare the opening of the
        // block rather than the whole of it: a wrong span misses from the first
        // character, and a right one cannot match by accident over 40.
        const checked = blocks.filter(
          (b) => b.type === "heading" || (b.type === "paragraph" && blockText(b).length > 40)
        );
        expect(checked.length).toBeGreaterThan(20);
        const misses = checked.filter(
          (b) =>
            !sliceText(html, b.source.start, b.source.end).includes(
              alphanumeric(blockText(b)).slice(0, 40)
            )
        );
        expect(misses.map((b) => blockText(b).slice(0, 60))).toEqual([]);
      });

      it("produces the same document with and without the trace", () => {
        expect(renderMarkdown(doc)).toEqual(renderMarkdown(parseEdgarHtml(html, name)));
      });

      it("accounts for every de-paginated block", () => {
        const raw = parseToBlocks(html);
        const { blocks: kept, dropped } = depaginateWithTrace(raw);
        const breaks = raw.filter((b) => b.type === "page-break").length;
        // Stitching replaces two tables with one, so kept + dropped + breaks
        // undershoots by the number of merges rather than balancing exactly.
        const merges = kept.reduce(
          (n, b) => n + (b.type === "table" ? b.node.stitchedFrom - 1 : 0),
          0
        );
        expect(kept.length + dropped.length + breaks + merges).toEqual(raw.length);
      });
    });
  }
});

describe("stitched tables", () => {
  it("spans both halves of a table split across a page break", () => {
    const html = `<html><body>
      <table><tr><th>Name</th><th>Shares</th></tr><tr><td>A</td><td>1</td></tr></table>
      <hr style="page-break-after:always" />
      <table><tr><th>Name</th><th>Shares</th></tr><tr><td>B</td><td>2</td></tr></table>
    </body></html>`;
    const { blocks } = depaginateWithTrace(parseToBlocks(html));
    const tables = blocks.filter((b) => b.type === "table");
    expect(tables).toHaveLength(1);
    const table = tables[0]!;
    expect(table.type === "table" && table.node.stitchedFrom).toBe(2);
    // The merged span must reach the second table's markup, not stop at the first.
    expect(html.slice(table.source.start, table.source.end)).toContain("B");
    expect(html.slice(table.source.start, table.source.end)).toContain("A");
  });
});
