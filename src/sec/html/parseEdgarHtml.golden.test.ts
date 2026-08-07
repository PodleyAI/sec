/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SectionNode, TableNode } from "workglow";
import { NodeKind, traverseDepthFirst } from "workglow";
import type { S1SectionName } from "../forms/registration-statements/s1/DocumentSegmenter";
import { S1_SECTIONS } from "../forms/registration-statements/s1/DocumentSegmenter";
import { DocumentTreeSegmenter } from "../forms/registration-statements/s1/DocumentTreeSegmenter";
import { parseEdgarHtml } from "./parseEdgarHtml";
import { fileURLToPath } from "node:url";
const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

const {
  MANAGEMENT,
  BENEFICIAL_OWNERSHIP,
  RELATED_PARTY,
  THE_OFFERING,
  UNDERWRITING,
  USE_OF_PROCEEDS,
  THE_SPONSOR,
  PROSPECTUS_SUMMARY,
  EXECUTIVE_COMPENSATION,
  RISK_FACTORS,
} = S1_SECTIONS;
const dir = join(importMetaDir, "mock_data", "s1");

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
  // Every SPAC fixture resolves EXECUTIVE_COMPENSATION. Only this one has the
  // heading promoted to a section by the tree; in the other three it is a plain
  // bolded line inside MANAGEMENT, recovered by the segmenter's nested-section
  // fallback. In all four the body is the blank-check company's statement that
  // no officer has been paid, which the Summary Compensation Table gate then
  // declines to send to a model.
  "s1_1848507_000119312521066104.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    EXECUTIVE_COMPENSATION,
    RISK_FACTORS,
  ],
  "s1_1849470_000110465921035696.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    EXECUTIVE_COMPENSATION,
    RISK_FACTORS,
  ],
  "s1_1822912_000121390021001475.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    EXECUTIVE_COMPENSATION,
    RISK_FACTORS,
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
    EXECUTIVE_COMPENSATION,
    RISK_FACTORS,
  ],
  // Operating companies — varied coverage / edge cases.
  "s1_2030954_000149315226027129.htm": [
    PROSPECTUS_SUMMARY,
    BENEFICIAL_OWNERSHIP,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    RISK_FACTORS,
  ],
  // atypical trust (3 stitched tables) — no mgmt/ownership/related-party headings,
  // but carries the offering sections incl. a focused "The Sponsor".
  "s1_2087989_000143774926019444.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    THE_SPONSOR,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    RISK_FACTORS,
  ],
  // Operating-company IPO carrying a real Summary Compensation Table, under the
  // "Compensation of Directors and Executive Officers" heading spelling and
  // followed by a separate Director Compensation table.
  "s1_1507957_000143774926010088.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    EXECUTIVE_COMPENSATION,
    RISK_FACTORS,
  ],
  // incorporation-by-reference S-1/A — offering mechanics present, entities by reference.
  "s1_1817004_000149315226027137.htm": [
    PROSPECTUS_SUMMARY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    RISK_FACTORS,
  ],
  // Modern Cayman SPAC — full section coverage, no focused "The Sponsor" heading.
  "s1_2147219_000110465926092088.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    EXECUTIVE_COMPENSATION,
    RISK_FACTORS,
  ],
  // Small operating-company IPO — same full coverage as the SPACs above, which is
  // what makes it a useful non-SPAC control for the golden-labelled extractors.
  "s1_95572_000121390026086369.htm": [
    PROSPECTUS_SUMMARY,
    MANAGEMENT,
    BENEFICIAL_OWNERSHIP,
    RELATED_PARTY,
    THE_OFFERING,
    UNDERWRITING,
    USE_OF_PROCEEDS,
    EXECUTIVE_COMPENSATION,
    RISK_FACTORS,
  ],
};

const SPAC_FIXTURES = [
  "s1_1848507_000119312521066104.htm",
  "s1_1849470_000110465921035696.htm",
  "s1_1822912_000121390021001475.htm",
  "s1_2114227_000121390026039320.htm",
  "s1_2147219_000110465926092088.htm",
];

/**
 * Minimum body size, in characters, of each resolved section. Section
 * *presence* alone is not enough: a section whose body is cut short at the
 * first page break still resolves, so a presence-only corpus stayed green while
 * every section of a 12 MB prospectus had been truncated to a few thousand
 * characters.
 *
 * Each floor is roughly half the size the section actually resolves to, so a
 * routine parser adjustment has room to move a section a little without
 * failing, while any halving of a section's body — the signature of silent
 * truncation — is caught. Re-derive the same way (observed / 2, rounded down)
 * when a deliberate change moves these.
 *
 * A section with no entry here is not size-checked, so adding a section to
 * {@link EXPECTED} does not require adding a floor.
 */
const MIN_SECTION_CHARS: Readonly<Record<string, Partial<Record<S1SectionName, number>>>> = {
  // Operating-company S-1 with a real Item 402 table. `Use of Proceeds` here is a
  // 110-char cross-reference stub rather than a body, so it carries no floor.
  "s1_1507957_000143774926010088.htm": {
    [PROSPECTUS_SUMMARY]: 6_000,
    [MANAGEMENT]: 5_000,
    [BENEFICIAL_OWNERSHIP]: 3_500,
    [RELATED_PARTY]: 500,
    [THE_OFFERING]: 800,
    [UNDERWRITING]: 2_500,
    [EXECUTIVE_COMPENSATION]: 9_000,
  },
  "s1_1848507_000119312521066104.htm": {
    [PROSPECTUS_SUMMARY]: 60_000,
    [MANAGEMENT]: 25_000,
    [BENEFICIAL_OWNERSHIP]: 6_000,
    [RELATED_PARTY]: 4_000,
    [THE_OFFERING]: 35_000,
    [UNDERWRITING]: 14_000,
    [USE_OF_PROCEEDS]: 7_000,
  },
  "s1_1849470_000110465921035696.htm": {
    [PROSPECTUS_SUMMARY]: 55_000,
    [MANAGEMENT]: 21_000,
    [BENEFICIAL_OWNERSHIP]: 5_000,
    [RELATED_PARTY]: 6_000,
    [THE_OFFERING]: 32_000,
    [UNDERWRITING]: 18_000,
    [USE_OF_PROCEEDS]: 8_000,
  },
  "s1_1822912_000121390021001475.htm": {
    [PROSPECTUS_SUMMARY]: 59_000,
    [MANAGEMENT]: 16_000,
    [BENEFICIAL_OWNERSHIP]: 4_000,
    [RELATED_PARTY]: 5_000,
    [THE_OFFERING]: 30_000,
    [UNDERWRITING]: 16_000,
    [USE_OF_PROCEEDS]: 9_000,
  },
  "s1_2114227_000121390026039320.htm": {
    [PROSPECTUS_SUMMARY]: 92_000,
    [MANAGEMENT]: 28_000,
    [BENEFICIAL_OWNERSHIP]: 6_000,
    [RELATED_PARTY]: 7_000,
    [THE_OFFERING]: 45_000,
    [UNDERWRITING]: 14_000,
    [USE_OF_PROCEEDS]: 9_000,
  },
  "s1_2147219_000110465926092088.htm": {
    [PROSPECTUS_SUMMARY]: 68_000,
    [MANAGEMENT]: 21_000,
    [BENEFICIAL_OWNERSHIP]: 4_000,
    [RELATED_PARTY]: 5_000,
    [THE_OFFERING]: 40_000,
    [UNDERWRITING]: 22_000,
    [USE_OF_PROCEEDS]: 7_000,
  },
  "s1_95572_000121390026086369.htm": {
    [PROSPECTUS_SUMMARY]: 19_000,
    [MANAGEMENT]: 12_000,
    [BENEFICIAL_OWNERSHIP]: 1_700,
    [RELATED_PARTY]: 6_000,
    [THE_OFFERING]: 3_000,
    [UNDERWRITING]: 9_000,
    [USE_OF_PROCEEDS]: 1_600,
  },
  "s1_2030954_000149315226027129.htm": {
    [PROSPECTUS_SUMMARY]: 3_000,
    [BENEFICIAL_OWNERSHIP]: 2_000,
    [THE_OFFERING]: 1_500,
    [UNDERWRITING]: 12_000,
    [USE_OF_PROCEEDS]: 1_000,
  },
  "s1_2087989_000143774926019444.htm": {
    [PROSPECTUS_SUMMARY]: 9_000,
    [THE_OFFERING]: 4_000,
    [THE_SPONSOR]: 4_000,
    [UNDERWRITING]: 2_000,
    [USE_OF_PROCEEDS]: 200,
  },
  "s1_1817004_000149315226027137.htm": {
    [PROSPECTUS_SUMMARY]: 7_000,
    [THE_OFFERING]: 400,
    [UNDERWRITING]: 2_000,
    [USE_OF_PROCEEDS]: 100,
  },
};

/**
 * Page furniture (a per-page "Table of Contents" back-link, a running issuer
 * header) recurs far more often than any real heading — three occurrences is
 * the most any genuine heading reaches across this corpus. Furniture that
 * survives into the tree becomes a section, and every such section closes the
 * one it interrupts, so this bound guards the truncation mechanism directly and
 * independently of the per-section sizes above.
 */
const MAX_REPEATED_SECTION_TITLE = 5;

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

    it(`${file}: every resolved section carries a full body, not a truncated one`, () => {
      const floors = MIN_SECTION_CHARS[file];
      expect(floors, `add a MIN_SECTION_CHARS entry for ${file}`).toBeDefined();
      const doc = parseEdgarHtml(html, file);
      const sizes = new Map(
        new DocumentTreeSegmenter().segment(doc).map((s) => [s.name, s.text.length])
      );
      for (const [name, min] of Object.entries(floors) as [S1SectionName, number][]) {
        expect(sizes.get(name) ?? 0, `${file} ${name} body`).toBeGreaterThanOrEqual(min);
      }
    });

    it(`${file}: no page furniture survives as a repeated section`, () => {
      const doc = parseEdgarHtml(html, file);
      const counts = new Map<string, number>();
      for (const node of traverseDepthFirst(doc)) {
        if (node.kind !== NodeKind.SECTION) continue;
        const title = (node as SectionNode).title.replace(/\s+/g, " ").trim().toLowerCase();
        counts.set(title, (counts.get(title) ?? 0) + 1);
      }
      for (const [title, n] of counts) {
        expect(n, `${file} repeats section "${title}"`).toBeLessThan(MAX_REPEATED_SECTION_TITLE);
      }
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
