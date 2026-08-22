/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getGoldenLabels } from "../../../../eval/goldenS1Labels";
import { loadS1Corpus, S1_CORPUS_TIMEOUT_MS, type S1CorpusFiling } from "./testing/s1Corpus";
import { S1_SECTIONS } from "./DocumentSegmenter";
import { parseSpacProfile } from "./parseSpacProfile";

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

let cases: Array<{ filing: string; summary: string }> = [];

describe("parseSpacProfile golden corpus", () => {
  // Building the corpus is ~100 MB of HTML through the converter and the
  // segmenter — that is the work, not a hang. It lives in `beforeAll` with its
  // own budget so the cost is attributed to setup rather than charged to
  // whichever assertion happened to touch it first.
  beforeAll(() => {
    cases = loadS1Corpus().map((f: S1CorpusFiling) => ({
      filing: f.filing,
      summary: f.byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY) ?? "",
    }));
  }, S1_CORPUS_TIMEOUT_MS);

  it("loads committed S-1 fixtures", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it("never false-hits a golden empty spac-profile label", () => {
    for (const { filing, summary } of cases) {
      const labels = getGoldenLabels(filing, "spac-profile");
      if (!emptyProfile(labels)) continue;
      expect(parseSpacProfile(summary), filing).toBeNull();
    }
  });

  it("does not invent tags outside the golden set when it hits a labelled filing", () => {
    for (const { filing, summary } of cases) {
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
