/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getGoldenFieldRows } from "../../../../eval/goldenS1Labels";
import { loadS1Corpus, S1_CORPUS_TIMEOUT_MS, type S1CorpusFiling } from "./testing/s1Corpus";
import { S1_SECTIONS } from "../../../html/sectionVocabulary";
import { parseSpacUnderwriters } from "./parseSpacUnderwriters";

function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim()
    .toLowerCase();
}

let cases: readonly S1CorpusFiling[] = [];

describe("parseSpacUnderwriters golden corpus", () => {
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

  it("never false-hits a golden empty underwriters label", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "underwriters");
      if (!labels || labels.length !== 0) continue;
      const text = byName.get(S1_SECTIONS.UNDERWRITING) ?? "";
      expect(
        parseSpacUnderwriters(text).map((r) => r.legal_name),
        filing
      ).toEqual([]);
    }
  });

  it("does not invent names outside the golden set when it hits", () => {
    for (const { filing, byName } of cases) {
      const labels = getGoldenFieldRows(filing, "underwriters");
      if (!labels || labels.length === 0) continue;
      const text = byName.get(S1_SECTIONS.UNDERWRITING) ?? "";
      const parsed = parseSpacUnderwriters(text);
      if (parsed.length === 0) continue;
      const allowed = new Set(
        labels
          .map((r) => (typeof r.legal_name === "string" ? nameKey(r.legal_name) : ""))
          .filter((k) => k !== "")
      );
      for (const row of parsed) {
        expect(allowed.has(nameKey(row.legal_name)), `${filing} extra ${row.legal_name}`).toBe(
          true
        );
      }
    }
  });
});
