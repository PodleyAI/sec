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
import { parseSummaryCompensationTable } from "./parseSummaryCompensationTable";

const MOCK_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../html/mock_data/s1");

function nameKey(s: string): string {
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

describe("parseSummaryCompensationTable golden corpus", () => {
  it("loads committed S-1 fixtures", () => {
    expect(cases().length).toBeGreaterThan(0);
  });

  it("never false-hits a golden empty executive-compensation label", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "executive-compensation");
      if (!labels || labels.length !== 0) continue;
      const text = byName.get(S1_SECTIONS.EXECUTIVE_COMPENSATION) ?? "";
      expect(parseSummaryCompensationTable(text), filing).toEqual([]);
    }
  });

  it("does not invent officers outside the golden set when it hits", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "executive-compensation");
      if (!labels || labels.length === 0) continue;
      const text = byName.get(S1_SECTIONS.EXECUTIVE_COMPENSATION) ?? "";
      const parsed = parseSummaryCompensationTable(text);
      if (parsed.length === 0) continue;
      const allowed = new Set(
        labels
          .map((r) => (typeof r.person_name === "string" ? nameKey(r.person_name) : ""))
          .filter((k) => k !== "")
      );
      const extras = parsed
        .map((row) => row.person_name)
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .filter((n) => n !== "" && !allowed.has(nameKey(n)));
      expect(extras, filing).toEqual([]);
    }
  });
});
