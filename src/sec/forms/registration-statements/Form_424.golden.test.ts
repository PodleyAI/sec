/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseInlineXbrl } from "../../xbrl/parseInlineXbrl";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import type { S1SectionName } from "../../html/sectionVocabulary";
import { fileURLToPath } from "node:url";
const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

const FIXTURES = join(importMetaDir, "../../html/mock_data/424");

/**
 * Real priced-IPO prospectus: Churchill Capital Corp XII 424B4 (the priced
 * companion to the committed `s1_2114227_*` registration fixture). It pins the
 * deterministic half of the priced-prospectus pipeline that feeds the AI
 * offering-sections pass — segmentation into The Offering / Underwriting / Use
 * of Proceeds — on a fee-prepaid SPAC 424B4 (Rule 456(a)), which carries no
 * inline XBRL / fee exhibit, so the untagged-body path is the production reality.
 */
describe("Form 424 golden: Churchill Capital Corp XII 424B4 (priced SPAC IPO)", () => {
  const html = readFileSync(join(FIXTURES, "424b4_2114227_000121390026048413.htm"), "utf8");

  it("carries no inline XBRL (fee-prepaid SPAC 424B4 — untagged body path)", () => {
    const xbrl = parseInlineXbrl(html);
    expect(xbrl.hasXbrl).toBe(false);
    expect(xbrl.facts).toHaveLength(0);
  });

  const sections = new DocumentTreeSegmenter().segment(
    parseEdgarHtml(html, "424B4 0001213900-26-048413")
  );
  const byName = new Map<S1SectionName, string>(sections.map((s) => [s.name, s.text]));

  it("segments the priced prospectus into the three offering sections", () => {
    // These are exactly the sections the priced-424 AI pass extracts
    // (offering-terms, underwriters, use-of-proceeds).
    expect(byName.has("The Offering")).toBe(true);
    expect(byName.has("Underwriting")).toBe(true);
    expect(byName.has("Use of Proceeds")).toBe(true);
    // Substantial narrative, not a stray heading match.
    expect(byName.get("The Offering")!.length).toBeGreaterThan(10000);
    expect(byName.get("Underwriting")!.length).toBeGreaterThan(5000);
    expect(byName.get("Use of Proceeds")!.length).toBeGreaterThan(5000);
  });

  it("carries the FINAL priced deal terms in the offering prose", () => {
    // The 424B4 records the final deal (36,000,000 units at $10.00) — distinct
    // from the S-1's registered/anticipated terms that `sec issuer deal`
    // compares against.
    const useOfProceeds = byName.get("Use of Proceeds")!;
    expect(useOfProceeds).toContain("36,000,000 units");
    expect(useOfProceeds).toContain("$10.00 per unit");
    // The underwriting section names the book-running underwriter deterministically.
    expect(byName.get("Underwriting")!).toContain("Citigroup Global Markets Inc.");
  });
});
