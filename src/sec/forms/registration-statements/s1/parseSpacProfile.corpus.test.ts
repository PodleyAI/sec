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
import { parseSpacProfile } from "./parseSpacProfile";

const MOCK_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../html/mock_data/s1");

function nameKey(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function emptyProfile(labels: readonly Record<string, unknown>[] | undefined): boolean {
  if (labels === undefined || labels.length === 0) return true;
  const row = labels[0]!;
  const focus = Array.isArray(row.focus) ? row.focus : [];
  const loc = Array.isArray(row.focus_location) ? row.focus_location : [];
  return focus.length === 0 && loc.length === 0;
}

function fixtures(): Array<{ filing: string; summary: string }> {
  const files = readdirSync(MOCK_DIR).filter((f) => f.endsWith(".htm"));
  const out: Array<{ filing: string; summary: string }> = [];
  for (const file of files.sort()) {
    const html = readFileSync(join(MOCK_DIR, file), "utf8");
    const doc = parseEdgarHtml(html, file);
    const segmented = new DocumentTreeSegmenter().segment(doc);
    const byName = new Map(segmented.map((s) => [s.name as string, s.text]));
    out.push({
      filing: file.replace(/\.htm$/, ""),
      summary: byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY) ?? "",
    });
  }
  return out;
}

let corpus: ReturnType<typeof fixtures> | undefined;
function cases(): ReturnType<typeof fixtures> {
  corpus ??= fixtures();
  return corpus;
}

describe("parseSpacProfile golden corpus", () => {
  it("loads committed S-1 fixtures", () => {
    expect(cases().length).toBeGreaterThan(0);
  });

  it("never false-hits a golden empty spac-profile label", () => {
    for (const { filing, summary } of cases()) {
      const labels = getGoldenLabels(filing, "spac-profile");
      if (!emptyProfile(labels)) continue;
      expect(parseSpacProfile(summary), filing).toBeNull();
    }
  });

  it("does not invent tags outside the golden set when it hits a labelled filing", () => {
    for (const { filing, summary } of cases()) {
      const labels = getGoldenLabels(filing, "spac-profile");
      if (emptyProfile(labels)) continue;
      const parsed = parseSpacProfile(summary);
      if (parsed === null) continue;
      const allowed = new Set(
        [...(labels![0]!.focus as string[]), ...(labels![0]!.focus_location as string[])].map(
          nameKey
        )
      );
      const extras = [...parsed.focus, ...parsed.focus_location]
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .filter((n) => !allowed.has(nameKey(n)));
      expect(extras, filing).toEqual([]);
    }
  });
});
