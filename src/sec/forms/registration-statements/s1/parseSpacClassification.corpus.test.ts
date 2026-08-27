/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { getGoldenFieldRows } from "../../../../eval/goldenS1Labels";
import { loadS1Corpus, S1_CORPUS_TIMEOUT_MS, type S1CorpusFiling } from "./testing/s1Corpus";
import { S1_SECTIONS } from "./DocumentSegmenter";
import { parseSpacClassification } from "./parseSpacClassification";

let cases: Array<{ filing: string; summary: string }> = [];

describe("parseSpacClassification golden corpus", () => {
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

  it("never false-hits a golden empty spac-classification label", () => {
    for (const { filing, summary } of cases) {
      const labels = getGoldenFieldRows(filing, "spac-classification");
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
    for (const { filing, summary } of cases) {
      const labels = getGoldenFieldRows(filing, "spac-classification");
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
