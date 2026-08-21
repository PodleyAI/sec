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
import { parseSpacClassification } from "./parseSpacClassification";

const MOCK_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../html/mock_data/s1");

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

describe("parseSpacClassification golden corpus", () => {
  it("loads committed S-1 fixtures", () => {
    expect(cases().length).toBeGreaterThan(0);
  });

  it("never false-hits a golden empty spac-classification label", () => {
    for (const { filing, summary } of cases()) {
      const labels = getGoldenLabels(filing, "spac-classification");
      if (!labels || labels.length !== 0) continue;
      expect(parseSpacClassification(summary), filing).toBeNull();
    }
  });

  // This pass DOES stand in for the model — a filing is classified once, so the
  // row it returns is the whole population — which makes it the one wired parse
  // whose verdict is never checked against a model. It has to agree with the
  // labels on every filing it answers for.
  it("agrees with the golden classification on every filing it answers", () => {
    const disagreements: string[] = [];
    for (const { filing, summary } of cases()) {
      const labels = getGoldenLabels(filing, "spac-classification");
      if (!labels || labels.length === 0) continue;
      const parsed = parseSpacClassification(summary);
      if (parsed === null) continue;
      const label = labels[0]!;
      if (parsed.is_spac !== label.is_spac || parsed.entity_kind !== label.entity_kind) {
        disagreements.push(
          `${filing}: parsed ${parsed.entity_kind}/${parsed.is_spac}, golden ${String(label.entity_kind)}/${String(label.is_spac)}`
        );
      }
    }
    expect(disagreements).toEqual([]);
  });
});
