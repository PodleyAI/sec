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
import { parseSpacSponsors } from "./parseSpacSponsors";

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

function sponsorText(byName: Map<string, string>): string {
  return (
    byName.get(S1_SECTIONS.THE_SPONSOR) ??
    [...byName.entries()]
      .filter(([name]) => name !== S1_SECTIONS.RISK_FACTORS)
      .map(([, sectionText]) => sectionText)
      .join("\n\n")
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

describe("parseSpacSponsors golden corpus", () => {
  it("loads committed S-1 fixtures", () => {
    expect(cases().length).toBeGreaterThan(0);
  });

  it("never false-hits a golden empty spac-sponsors label", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "spac-sponsors");
      if (!labels || labels.length !== 0) continue;
      expect(parseSpacSponsors(sponsorText(byName)), filing).toEqual([]);
    }
  });

  it("does not invent names outside the golden set when it hits a labelled filing", () => {
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "spac-sponsors");
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
    for (const { filing, byName } of cases()) {
      const labels = getGoldenLabels(filing, "spac-sponsors");
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
