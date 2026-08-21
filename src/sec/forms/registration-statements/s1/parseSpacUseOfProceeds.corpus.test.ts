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
import { S1_SECTIONS } from "./DocumentSegmenter";
import { parseSpacUseOfProceeds, useOfProceedsIsComplete } from "./parseSpacUseOfProceeds";

const MOCK_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../html/mock_data/s1");

function purposeKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
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

describe("parseSpacUseOfProceeds golden corpus", () => {
  it("loads committed S-1 fixtures", () => {
    expect(cases().length).toBeGreaterThan(0);
  });

  it("never false-hits a golden empty use-of-proceeds label", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "use-of-proceeds");
      if (!labels || labels.length !== 0) continue;
      const text = byName.get(S1_SECTIONS.USE_OF_PROCEEDS) ?? "";
      expect(parseSpacUseOfProceeds(text), filing).toEqual([]);
    }
  });

  it("does not invent purposes outside the golden set when it hits", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "use-of-proceeds");
      if (!labels || labels.length === 0) continue;
      const text = byName.get(S1_SECTIONS.USE_OF_PROCEEDS) ?? "";
      const parsed = parseSpacUseOfProceeds(text);
      if (parsed.length === 0) continue;
      const allowed = new Set(
        labels
          .map((r) => (typeof r.purpose === "string" ? purposeKey(r.purpose) : ""))
          .filter((k) => k !== "")
      );
      const extras = parsed
        .map((row) => row.purpose ?? "")
        .filter((p) => p !== "" && !allowed.has(purposeKey(p)));
      expect(extras, filing).toEqual([]);
    }
  });

  // Recall, not precision. A skip rule matching a phrase ANYWHERE in the label
  // deleted the underwriting-commission row from 13 filings and 16 line items
  // in this corpus — the largest expense in each — while every precision
  // assertion above stayed green, because a dropped row invents nothing.
  it("finds every golden line item on a filing it claims to have enumerated", () => {
    const misses: string[] = [];
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "use-of-proceeds");
      if (!labels || labels.length === 0) continue;
      const text = byName.get(S1_SECTIONS.USE_OF_PROCEEDS) ?? "";
      if (!useOfProceedsIsComplete(text)) continue;
      const found = new Set(parseSpacUseOfProceeds(text).map((r) => purposeKey(r.purpose ?? "")));
      for (const label of labels) {
        const purpose = typeof label.purpose === "string" ? label.purpose : "";
        if (purpose !== "" && !found.has(purposeKey(purpose))) misses.push(`${filing}: ${purpose}`);
      }
    }
    expect(misses).toEqual([]);
  });

  // The predicate above is only worth anything if it says yes to real filings.
  it("claims a complete enumeration on most of the corpus it parses", () => {
    const parsing = cases().filter(
      ({ byName }) =>
        parseSpacUseOfProceeds(byName.get(S1_SECTIONS.USE_OF_PROCEEDS) ?? "").length > 0
    );
    const complete = parsing.filter(({ byName }) =>
      useOfProceedsIsComplete(byName.get(S1_SECTIONS.USE_OF_PROCEEDS) ?? "")
    );
    expect(parsing.length).toBeGreaterThanOrEqual(20);
    expect(complete.length).toBeGreaterThanOrEqual(16);
  });
});
