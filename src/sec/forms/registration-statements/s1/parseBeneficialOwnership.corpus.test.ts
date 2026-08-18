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
import { parseBeneficialOwnership } from "./parseBeneficialOwnership";

const MOCK_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../html/mock_data/s1");

function nameKey(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, "").toLowerCase();
}

function coveredName(n: string, allowed: Set<string>): boolean {
  const k = nameKey(n);
  if (allowed.has(k)) return true;
  for (const a of allowed) {
    if (k.startsWith(a) || a.startsWith(k)) return true;
  }
  return false;
}

function looksLikeCaption(n: string): boolean {
  return (
    /:\s*$/.test(n) ||
    /shares beneficially|named executive|principal shareholders|table of contents/i.test(n)
  );
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

describe("parseBeneficialOwnership golden corpus", () => {
  it("loads committed S-1 fixtures", () => {
    expect(cases().length).toBeGreaterThan(0);
  });

  it("never false-hits a golden empty beneficial-ownership label", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "beneficial-ownership");
      if (!labels || labels.length !== 0) continue;
      const text = byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP) ?? "";
      expect(parseBeneficialOwnership(text), filing).toEqual([]);
    }
  });

  it("does not invent owners outside the golden set when it hits", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "beneficial-ownership");
      if (!labels || labels.length === 0) continue;
      const text = byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP) ?? "";
      const parsed = parseBeneficialOwnership(text);
      if (parsed.length === 0) continue;
      const allowed = new Set(
        labels
          .map((r) => (typeof r.name === "string" ? nameKey(r.name) : ""))
          .filter((k) => k !== "")
      );
      const extras = parsed
        .map((row) => row.name)
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .filter((n) => n !== "" && !coveredName(n, allowed));
      const garbage = extras.filter((n) => looksLikeCaption(n));
      expect(garbage, filing).toEqual([]);
    }
  });
});
