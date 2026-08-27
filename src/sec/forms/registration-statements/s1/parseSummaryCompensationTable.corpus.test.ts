/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getGoldenFieldRows } from "../../../../eval/goldenS1Labels";
import { loadS1Corpus, S1_CORPUS_TIMEOUT_MS, type S1CorpusFiling } from "./testing/s1Corpus";
import { S1_SECTIONS } from "./DocumentSegmenter";
import { parseSummaryCompensationTable } from "./parseSummaryCompensationTable";

function nameKey(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

let cases: readonly S1CorpusFiling[] = [];

describe("parseSummaryCompensationTable golden corpus", () => {
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

  it("never false-hits a golden empty executive-compensation label", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "executive-compensation");
      if (!labels || labels.length !== 0) continue;
      const text = byName.get(S1_SECTIONS.EXECUTIVE_COMPENSATION) ?? "";
      expect(parseSummaryCompensationTable(text), filing).toEqual([]);
    }
  });

  it("does not invent officers outside the golden set when it hits", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "executive-compensation");
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
