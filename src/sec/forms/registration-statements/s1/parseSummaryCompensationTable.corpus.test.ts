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

  // Officers this parser reports that the golden set does not list. Every entry
  // is the same thing and none of them is an invention: the parser returns the
  // name verbatim from the Summary Compensation Table, and the label carries a
  // fuller rendering of the same person — "Richard Foust" against "Richard John
  // Foust", "Mil L. (Flip) Wallen" against "Millard L. Wallen, III". Unlike the
  // sibling ownership corpus this check does not fuzz at all: it compares
  // whitespace-stripped names for equality, so any difference at all lands here.
  //
  // The fuller name is usually elsewhere in the same filing — "Richard John
  // Foust" appears only under Principal and Selling Stockholders, a section
  // this parser is never handed. The labels are right to record it:
  // `goldenS1Labels.test.ts` grounds names against the WHOLE filing on purpose,
  // because a golden row records the entity rather than one section's
  // rendering of it.
  //
  // Pinned as one list rather than asserted per filing so the bar stays exact.
  // The old per-filing assertion threw on the first offender and never reached
  // the other five, which is how a corpus-wide count stays hidden.
  const KNOWN_LABEL_FORM_MISMATCHES: readonly string[] = [
    "s1_1489993_000162828026025811: Richard Foust",
    "s1_1507957_000143774926010088: Timothy Burns",
    "s1_1880613_000162828026005423: Keith Smith",
    "s1_1880613_000162828026005423: Mark Walker",
    "s1_1918102_000110465926016226: Richard Muller, Ph.D.",
    "s1_95572_000121390026086369: Mil L. (Flip) Wallen",
  ];

  it("does not invent officers outside the golden set when it hits", () => {
    const extras: string[] = [];
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
      for (const name of parsed
        .map((row) => row.person_name)
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .filter((n) => n !== "" && !allowed.has(nameKey(n)))) {
        extras.push(`${filing}: ${name}`);
      }
    }
    expect(extras.sort()).toEqual([...KNOWN_LABEL_FORM_MISMATCHES].sort());
  });
});
