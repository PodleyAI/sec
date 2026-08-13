/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  defaultGoldenSweepExtractors,
  participatesInDefaultSweeps,
} from "./defaultSweepExtractors";
import { EVAL_EXTRACTORS } from "./fixtures";
import { extractorsWithGoldenLabels } from "./goldenS1Labels";

describe("participatesInDefaultSweeps", () => {
  it("excludes exactly the extractors flagged disabled", () => {
    const disabled = Object.keys(EVAL_EXTRACTORS).filter((n) => EVAL_EXTRACTORS[n].disabled);
    expect(disabled.length).toBeGreaterThan(0);
    for (const name of disabled) expect(participatesInDefaultSweeps(name)).toBe(false);
    for (const name of Object.keys(EVAL_EXTRACTORS)) {
      if (!disabled.includes(name)) expect(participatesInDefaultSweeps(name)).toBe(true);
    }
  });

  it("does not exclude an unregistered name", () => {
    // `eval s1` validates `--extractors` against EVAL_EXTRACTORS separately;
    // this predicate answers only "is it flagged out", so an unknown name must
    // not be silently swallowed here instead of erroring there.
    expect(participatesInDefaultSweeps("no-such-extractor")).toBe(true);
  });
});

describe("defaultGoldenSweepExtractors", () => {
  it("drops a disabled extractor from the default golden sweep", () => {
    // `risk-factors` carries golden labels on every committed filing and is the
    // only chunked extractor (up to ~246k chars, several calls per section), so
    // a bare `sec eval s1` paid for it in full despite being flagged out of
    // default sweeps — the flag reached `eval extract` and not this path.
    expect(extractorsWithGoldenLabels()).toContain("risk-factors");
    expect(defaultGoldenSweepExtractors()).not.toContain("risk-factors");
  });

  it("keeps every labelled extractor that is not flagged out", () => {
    expect(defaultGoldenSweepExtractors()).toContain("beneficial-ownership");
    expect(defaultGoldenSweepExtractors()).toEqual(
      extractorsWithGoldenLabels().filter((n) => !EVAL_EXTRACTORS[n]?.disabled)
    );
  });

  it("leaves the labels index itself complete", () => {
    // The index is what `goldenS1Labels.test.ts` reads to prove every committed
    // label is reachable and every committed section is labelled. Filtering
    // `disabled` in there would drop a disabled extractor's labels out from
    // under that guard, so the two questions stay separate functions.
    expect(extractorsWithGoldenLabels().length).toBeGreaterThan(
      defaultGoldenSweepExtractors().length
    );
  });
});
