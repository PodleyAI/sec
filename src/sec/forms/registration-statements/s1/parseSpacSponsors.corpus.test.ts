/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getGoldenFieldRows } from "../../../../eval/goldenS1Labels";
import { loadS1Corpus, S1_CORPUS_TIMEOUT_MS, type S1CorpusFiling } from "./testing/s1Corpus";
import { S1_SECTIONS } from "./DocumentSegmenter";
import { parseSpacSponsors } from "./parseSpacSponsors";

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

function sponsorText(byName: ReadonlyMap<string, string>): string {
  return (
    byName.get(S1_SECTIONS.THE_SPONSOR) ??
    [...byName.entries()]
      .filter(([name]) => name !== S1_SECTIONS.RISK_FACTORS)
      .map(([, sectionText]) => sectionText)
      .join("\n\n")
  );
}

let cases: readonly S1CorpusFiling[] = [];

describe("parseSpacSponsors golden corpus", () => {
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

  it("never false-hits a golden empty spac-sponsors label", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "spac-sponsors");
      if (!labels || labels.length !== 0) continue;
      expect(parseSpacSponsors(sponsorText(byName)), filing).toEqual([]);
    }
  });

  it("does not invent names outside the golden set when it hits a labelled filing", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "spac-sponsors");
      if (!labels || labels.length === 0) continue;
      const parsed = parseSpacSponsors(sponsorText(byName));
      if (parsed.length === 0) continue;
      const allowed = new Set(
        labels
          .map((r) => (typeof r.legal_name === "string" ? nameKey(r.legal_name) : ""))
          .filter((k) => k !== "")
      );
      const extras = parsed
        .map((row) => row.legal_name)
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .filter((n) => n !== "" && !coveredName(n, allowed));
      expect(extras, filing).toEqual([]);
    }
  });

  // Recall, not precision. The precision assertion above passes on a parse that
  // found one of two sponsors, and `spac_sponsor_link` is cleared per accession
  // before the rows are rewritten — so a shortfall here would be a deleted
  // sponsor, not a missing hit, if this parse were ever allowed to preempt.
  it("finds every golden sponsor on a filing it hits", () => {
    const misses: string[] = [];
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "spac-sponsors");
      if (!labels || labels.length === 0) continue;
      const parsed = parseSpacSponsors(sponsorText(byName));
      if (parsed.length === 0) continue;
      const found = new Set(parsed.map((r) => nameKey(r.legal_name)));
      for (const label of labels) {
        const name = typeof label.legal_name === "string" ? label.legal_name : "";
        if (name !== "" && !coveredName(name, found)) misses.push(`${filing}: ${name}`);
      }
    }
    expect(misses).toEqual([]);
  });

  // The two patterns both require `our|the` immediately before `sponsor`, so a
  // "our co-sponsor, Beta Holdings LLC, is …" introduction matches neither and
  // nothing derived from them can report that the prose named no one else.
  // Pinned because the pass is wired with no completeness claim for exactly
  // this reason, and a stray `complete: () => true` would read as a tidy-up.
  it("cannot see a sponsor the prose introduces as a co-sponsor", () => {
    const text =
      "Our sponsor, Alpha Sponsor LLC, is a Delaware limited liability company. " +
      "Our co-sponsor, Beta Holdings LLC, is an affiliate of our chief executive officer.";

    expect(parseSpacSponsors(text).map((r) => r.legal_name)).toEqual(["Alpha Sponsor LLC"]);
  });
});
