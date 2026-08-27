/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getGoldenFieldRows } from "../../../../eval/goldenS1Labels";
import { loadS1Corpus, S1_CORPUS_TIMEOUT_MS, type S1CorpusFiling } from "./testing/s1Corpus";
import { S1_SECTIONS } from "./DocumentSegmenter";
import { parseBeneficialOwnership } from "./parseBeneficialOwnership";

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

let cases: readonly S1CorpusFiling[] = [];

describe("parseBeneficialOwnership golden corpus", () => {
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

  it("never false-hits a golden empty beneficial-ownership label", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "beneficial-ownership");
      if (!labels || labels.length !== 0) continue;
      const text = byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP) ?? "";
      expect(parseBeneficialOwnership(text), filing).toEqual([]);
    }
  });

  it("does not invent owners outside the golden set when it hits", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "beneficial-ownership");
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

  // Recall, which the precision assertions above cannot see: a dropped owner
  // invents nothing. Two distinct causes, kept apart because only one of them
  // is this parser's to answer for.
  //
  // Owners the walk genuinely does not produce. The table row is not the
  // owner the label records:
  //
  //   - s1_1507957 prints one row, the defined term "AIGH". The three names
  //     labelled against it are disclosed in footnote (2), and the walk reads
  //     the table, not the footnotes.
  //   - s1_1602409 glues each holder to the entities beside them into a single
  //     owner cell — the walk returns "Terren S. Peizer Acuitas Group
  //     Holdings, LLC Acuitas Capital LLC" as one name, so the three entity
  //     labels match nothing.
  //
  // Pinned rather than fixed because the pass they back is wired with no
  // completeness claim and therefore never stands in for the model: nothing is
  // lost today. The list is the bar — a NEW gap fails here, and closing one of
  // these fails here too, which is the prompt to reconsider the claim.
  const KNOWN_RECALL_GAPS: readonly string[] = [
    "s1_1507957_000143774926010088: AIGH Capital Management, LLC",
    "s1_1507957_000143774926010088: AIGH Investment Partners, LLC",
    "s1_1507957_000143774926010088: Orin Hirschman",
    "s1_1602409_000152013826000232: Acuitas Group Holdings, LLC",
    "s1_1602409_000152013826000232: Acuitas Capital LLC",
    "s1_1602409_000152013826000232: Dorado Goose, LLC",
  ];

  // Owners the walk DID find, under the name the ownership table prints. The
  // label carries a different rendering of the same person, so the match fails
  // on the name and not on the extraction: "Stephen Sadle" against the label's
  // "Stephen L. Sadle", "Hassan R. Baqar" against "Hassan Raza Baqar". One is
  // not even a middle initial — s1_1918102's filer spells the same director
  // "Jonathan" in the ownership table and "Jonathon" under Management, and the
  // label took the latter. `coveredName` fuzzes by prefix in both directions,
  // which an interpolated initial or a changed letter defeats.
  //
  // Nothing is wrong with these labels. `goldenS1Labels.test.ts` grounds names
  // against the WHOLE filing on purpose, because a golden row records the
  // entity rather than one section's rendering of it — so this list is the
  // section-scoped parser meeting that choice, which is the gap the corpus
  // exists to make visible rather than a defect to fix in this file.
  const KNOWN_LABEL_FORM_MISMATCHES: readonly string[] = [
    "s1_1507957_000143774926010088: Timothy W. Burns",
    "s1_1918102_000110465926016226: Jonathon Angell",
    "s1_1918102_000110465926016226: Richard A. Muller",
    "s1_2093507_000182912626003406: Hassan Raza Baqar",
    "s1_2093507_000182912626003406: Scott D. Wollney",
    "s1_2134856_000182912626007847: Richard C. Davis",
    "s1_95572_000121390026086369: Stephen L. Sadle",
  ];

  it("misses only the owners its own filters are known to drop", () => {
    const misses: string[] = [];
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "beneficial-ownership");
      if (!labels || labels.length === 0) continue;
      const text = byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP) ?? "";
      const parsed = parseBeneficialOwnership(text);
      if (parsed.length === 0) continue;
      const found = new Set(parsed.map((r) => nameKey(r.name)));
      for (const label of labels) {
        const name = typeof label.name === "string" ? label.name : "";
        if (name !== "" && !coveredName(name, found)) misses.push(`${filing}: ${name}`);
      }
    }
    expect(misses.sort()).toEqual([...KNOWN_RECALL_GAPS, ...KNOWN_LABEL_FORM_MISMATCHES].sort());
  });
});
