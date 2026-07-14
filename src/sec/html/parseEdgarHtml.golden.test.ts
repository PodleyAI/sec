/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TableNode } from "workglow";
import { NodeKind, traverseDepthFirst } from "workglow";
import type { S1SectionName } from "../forms/registration-statements/s1/DocumentSegmenter";
import { S1_SECTIONS } from "../forms/registration-statements/s1/DocumentSegmenter";
import { DocumentTreeSegmenter } from "../forms/registration-statements/s1/DocumentTreeSegmenter";
import { parseEdgarHtml } from "./parseEdgarHtml";

const {
  MANAGEMENT,
  BENEFICIAL_OWNERSHIP,
  RELATED_PARTY,
  THE_OFFERING,
  UNDERWRITING,
  USE_OF_PROCEEDS,
  THE_SPONSOR,
  PROSPECTUS_SUMMARY,
} = S1_SECTIONS;
const dir = join(import.meta.dir, "mock_data", "s1");

/**
 * Real-filing corpus (see SOURCES.md). The expected target sections pin the
 * converter + segmenter behavior against real markup; update intentionally when
 * heading detection or the section patterns change.
 */
const EXPECTED: Record<string, readonly S1SectionName[]> = {
  // SPACs (SIC 6770) — standard, complete section structure (incl. offering sections).
  // Every real S-1 opens with a prospectus summary ("Our Company" / "Overview" /
  // "This summary…"), which the PROSPECTUS_SUMMARY section now captures.
  // THE_OFFERING here is an ALIGN="center"-attribute bold box title at body
  // size — pinned since the StyleResolver learned the legacy align attribute
  // and heading levels rank by prominence tiers.
  "s1_1848507_000119312521066104.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
  ],
  "s1_1849470_000110465921035696.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
  ],
  "s1_1822912_000121390021001475.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
  ],
  // 2026 SPAC with full iXBRL tagging (spac/dei taxonomies) — also exercised
  // by parseXbrl.golden.test.ts.
  "s1_2114227_000121390026039320.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
  ],
  // Operating companies — varied coverage / edge cases.
  "s1_2030954_000149315226027129.htm": [
    PROSPECTUS_SUMMARY,
    BENEFICIAL_OWNERSHIP,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
  ],
  // atypical trust (3 stitched tables) — no mgmt/ownership/related-party headings,
  // but carries the offering sections incl. a focused "The Sponsor".
  "s1_2087989_000143774926019444.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    THE_SPONSOR,
    UNDERWRITING,
    USE_OF_PROCEEDS,
  ],
  // incorporation-by-reference S-1/A — offering mechanics present, entities by reference.
  "s1_1817004_000149315226027137.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
  ],
};

const SPAC_FIXTURES = [
  "s1_1848507_000119312521066104.htm",
  "s1_1849470_000110465921035696.htm",
  "s1_1822912_000121390021001475.htm",
  "s1_2114227_000121390026039320.htm",
];

const fixtures = readdirSync(dir).filter((f) => f.endsWith(".htm"));

describe("parseEdgarHtml golden fixtures (real EDGAR S-1 filings)", () => {
  it("has a sample including at least three SPACs", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
    expect(SPAC_FIXTURES.every((f) => fixtures.includes(f))).toBe(true);
  });

  for (const file of fixtures) {
    const html = readFileSync(join(dir, file), "utf8");

    it(`${file}: parses real markup into a rich tree (no content collapse)`, () => {
      const doc = parseEdgarHtml(html, file);
      const nodes = [...traverseDepthFirst(doc)];
      // A full prospectus must not collapse (the page-container regression
      // dropped a 12 MB filing to ~6 nodes).
      expect(nodes.length).toBeGreaterThan(50);
      expect(nodes.filter((n) => n.kind === NodeKind.SECTION).length).toBeGreaterThan(10);
      expect(nodes.filter((n) => n.kind === NodeKind.TABLE).length).toBeGreaterThan(5);
    });

    it(`${file}: resolves exactly its expected target sections`, () => {
      const expected = EXPECTED[file];
      expect(expected, `add an EXPECTED entry for ${file}`).toBeDefined();
      const doc = parseEdgarHtml(html, file);
      const resolved = new DocumentTreeSegmenter().segment(doc).map((s) => s.name);
      expect(new Set(resolved)).toEqual(new Set(expected));
    });

    it(`${file}: no stitched table leaves a duplicated header row in its body`, () => {
      const doc = parseEdgarHtml(html, file);
      const tables = [...traverseDepthFirst(doc)].filter(
        (n) => n.kind === NodeKind.TABLE
      ) as TableNode[];
      for (const t of tables) {
        if (t.stitchedFrom > 1 && t.headerRows.length > 0) {
          const headerKey = t.headerRows[0].map((c) => c.text.trim()).join("|");
          expect(t.rows.some((r) => r.map((c) => c.text.trim()).join("|") === headerKey)).toBe(
            false
          );
        }
      }
    });
  }

  it("extracts all three target sections from every SPAC fixture", () => {
    for (const file of SPAC_FIXTURES) {
      const doc = parseEdgarHtml(readFileSync(join(dir, file), "utf8"), file);
      const resolved = new Set(new DocumentTreeSegmenter().segment(doc).map((s) => s.name));
      expect(resolved.has(MANAGEMENT), `${file} management`).toBe(true);
      expect(resolved.has(BENEFICIAL_OWNERSHIP), `${file} ownership`).toBe(true);
      expect(resolved.has(RELATED_PARTY), `${file} related-party`).toBe(true);
    }
  });
});
