/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getGoldenFieldRows } from "../../../../eval/goldenS1Labels";
import { loadS1Corpus, S1_CORPUS_TIMEOUT_MS, type S1CorpusFiling } from "./testing/s1Corpus";
import { S1_SECTIONS } from "./DocumentSegmenter";
import { parseManagementRoster } from "./parseManagementRoster";

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
    /table of contents|directors and executive|named executive|principal occupation/i.test(n)
  );
}

let cases: readonly S1CorpusFiling[] = [];

describe("parseManagementRoster golden corpus", () => {
  // Building the corpus is ~100 MB of HTML through the converter and the
  // segmenter — that is the work, not a hang. It lives in `beforeAll` with its
  // own budget so the cost is attributed to setup rather than charged to
  // whichever assertion happened to touch it first.
  beforeAll(() => {
    cases = loadS1Corpus();
  }, S1_CORPUS_TIMEOUT_MS);

  it("loads committed S-1 fixtures", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it("never false-hits a golden empty management label", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "management");
      if (!labels || labels.length !== 0) continue;
      const text = byName.get(S1_SECTIONS.MANAGEMENT) ?? "";
      expect(parseManagementRoster(text), filing).toEqual([]);
    }
  });

  it("does not invent caption-like names outside the golden set when it hits", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "management");
      if (!labels || labels.length === 0) continue;
      const text = byName.get(S1_SECTIONS.MANAGEMENT) ?? "";
      const parsed = parseManagementRoster(text);
      if (parsed.length === 0) continue;
      const allowed = new Set(
        labels
          .map((r) => (typeof r.full_name === "string" ? nameKey(r.full_name) : ""))
          .filter((k) => k !== "")
      );
      const extras = parsed
        .map((row) => row.full_name)
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .filter((n) => n !== "" && !coveredName(n, allowed));
      const garbage = extras.filter((n) => looksLikeCaption(n));
      expect(garbage, filing).toEqual([]);
    }
  });
});
