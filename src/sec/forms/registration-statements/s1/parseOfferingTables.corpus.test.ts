/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getGoldenLabels } from "../../../../eval/goldenS1Labels";
import { parseEdgarHtml } from "../../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "./DocumentTreeSegmenter";
import { offeringParseText, promoteParseText } from "./offeringSections";
import {
  parseSpacOfferingTerms,
  parseSpacPromoteTerms,
  promoteCoverage,
} from "./parseOfferingTables";

const MOCK_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../html/mock_data/s1");

const OFFERING_FIELDS = [
  "price_per_unit",
  "warrant_fraction_per_unit",
  "right_fraction_per_unit",
  "trust_per_unit",
] as const;

const PROMOTE_FIELDS = [
  "founder_shares",
  "founder_percent",
  "private_placement_warrants",
  "public_warrant_coverage",
  "trust_per_public_share",
] as const;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

function scored(
  row: Record<string, unknown> | null,
  fields: readonly string[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row?.[f];
    out[f] = typeof v === "number" && Number.isFinite(v) ? round4(v) : (v ?? null);
  }
  return out;
}

const OPTIONAL_FIELDS = new Set<string>([
  "warrant_fraction_per_unit",
  "right_fraction_per_unit",
  "trust_per_unit",
  "founder_percent",
  "private_placement_warrants",
  "public_warrant_coverage",
]);

function expectScoredFields(
  filing: string,
  got: Record<string, unknown>,
  expected: Record<string, unknown>,
  fields: readonly string[]
): void {
  for (const f of fields) {
    if (expected[f] == null) continue;
    if (got[f] == null && OPTIONAL_FIELDS.has(f)) continue;
    expect(got[f], `${filing} ${f}`).toEqual(expected[f]);
  }
}

function isAllNull(row: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((f) => row[f] == null);
}

function fixtures(): Array<{ filing: string; byName: Map<string, string> }> {
  const files = readdirSync(MOCK_DIR).filter((f) => f.endsWith(".htm"));
  const out: Array<{ filing: string; byName: Map<string, string> }> = [];
  for (const file of files.sort()) {
    const html = readFileSync(join(MOCK_DIR, file), "utf8");
    const doc = parseEdgarHtml(html, file);
    const segmented = new DocumentTreeSegmenter().segment(doc);
    out.push({
      filing: file.replace(/\.htm$/, ""),
      byName: new Map(segmented.map((s) => [s.name as string, s.text])),
    });
  }
  return out;
}

let corpus: ReturnType<typeof fixtures> | undefined;
function cases(): ReturnType<typeof fixtures> {
  corpus ??= fixtures();
  return corpus;
}

describe("parseOfferingTables golden corpus", () => {
  it("loads committed S-1 fixtures", () => {
    expect(cases().length).toBeGreaterThan(0);
  });

  it("never claims a required-set hit against an all-null offering golden or empty promote golden", () => {
    for (const { filing, byName } of cases()) {
      const offeringLabels = getGoldenLabels(filing, "offering-terms");
      if (offeringLabels && offeringLabels.length === 1) {
        const expected = scored(offeringLabels[0] as Record<string, unknown>, OFFERING_FIELDS);
        if (isAllNull(expected, OFFERING_FIELDS)) {
          expect(parseSpacOfferingTerms(offeringParseText(byName)), filing).toBeNull();
        }
      }
      const promoteLabels = getGoldenLabels(filing, "sponsor-promote");
      if (promoteLabels && promoteLabels.length === 0) {
        expect(parseSpacPromoteTerms(promoteParseText(byName)), filing).toBeNull();
      }
    }
  });

  it("matches scored offering fields when it hits a labelled SPAC table", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "offering-terms");
      if (!labels || labels.length !== 1) continue;
      const expected = scored(labels[0] as Record<string, unknown>, OFFERING_FIELDS);
      if (isAllNull(expected, OFFERING_FIELDS)) continue;
      const parsed = parseSpacOfferingTerms(offeringParseText(byName));
      if (parsed === null) continue;
      const got = scored(parsed as unknown as Record<string, unknown>, OFFERING_FIELDS);
      expectScoredFields(filing, got, expected, OFFERING_FIELDS);
    }
  });

  it("matches scored promote fields when it hits a labelled SPAC table", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "sponsor-promote");
      if (!labels || labels.length === 0) continue;
      const expected = scored(labels[0] as Record<string, unknown>, PROMOTE_FIELDS);
      const parsed = parseSpacPromoteTerms(promoteParseText(byName));
      if (parsed === null) continue;
      const got = scored(parsed as unknown as Record<string, unknown>, PROMOTE_FIELDS);
      expectScoredFields(filing, got, expected, PROMOTE_FIELDS);
    }
  });

  // `spac_promote_terms` holds one row per filing, so the promote pass answers
  // the row question by producing that row and `promoteCoverage` carries the
  // whole risk: a column it claims is a column the model will not be asked for
  // and that persist will write. The assertion above forgives a null the walk
  // returned; a CLAIMED column may not be null and may not disagree.
  it("is right about every promote column its coverage claims", () => {
    const wrong: string[] = [];
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "sponsor-promote");
      if (!labels || labels.length === 0) continue;
      const text = promoteParseText(byName);
      const parsed = parseSpacPromoteTerms(text);
      if (parsed === null) continue;
      const claimed = promoteCoverage(text);
      const expected = scored(labels[0] as Record<string, unknown>, PROMOTE_FIELDS);
      const got = scored(parsed as unknown as Record<string, unknown>, PROMOTE_FIELDS);
      for (const field of PROMOTE_FIELDS) {
        if (!claimed.has(`spac_promote_terms.${field}`)) continue;
        if (expected[field] == null) continue;
        if (got[field] !== expected[field]) {
          wrong.push(
            `${filing} ${field}: parsed ${String(got[field])}, golden ${String(expected[field])}`
          );
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
