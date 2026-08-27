/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { FORM_TO_EXTRACTOR_ID } from "./extractorIds";
import { ExtractorRunSchema } from "./ExtractorRunSchema";

/**
 * `extractor_runs.form` must be wide enough for every form code the sweep can
 * route, and the bound is DERIVED from the routing table rather than pinned to a
 * number — so adding a longer form code fails here instead of in production.
 *
 * The failure this guards is silent in every existing test: the storage tests
 * run on InMemoryTabularStorage, which enforces no varchar width, so a form code
 * that overflows the column round-trips cleanly in memory and only fails against
 * a real database.
 *
 * It is also the WORST shape of failure, because the overflow happens on the
 * completion record rather than on the data. At maxLength 8, `CFPORTAL/A` (10)
 * stored its portal row successfully and then failed to record the run — so the
 * filing was re-selected by every subsequent sweep, forever, while never
 * appearing in dead-letter triage. That was 679 of the 817 portal filings, 83%
 * of the sweep, plus PRE 14A/A, PREN14A/A, PREM14A/A, PREC14A/A, 15F-12B/A,
 * 15F-12G/A and 15F-15D/A.
 */
describe("ExtractorRunSchema.form width", () => {
  const formCodes = Object.keys(FORM_TO_EXTRACTOR_ID);
  const maxLength = (ExtractorRunSchema.properties.form as { maxLength?: number }).maxLength;

  it("declares a maxLength", () => {
    expect(typeof maxLength).toBe("number");
  });

  it("fits every routable form code", () => {
    const tooLong = formCodes
      .filter((form) => form.length > (maxLength as number))
      .map((form) => `${form} (${form.length})`);

    expect(tooLong, `form codes exceeding maxLength ${maxLength}: ${tooLong.join(", ")}`).toEqual(
      []
    );
  });

  it("fits the longest form code with the length it actually has", () => {
    // Spelled out separately from the filter above so a failure names the
    // specific code that set the bound, which is what tells you what to widen to.
    const longest = formCodes.reduce((a, b) => (b.length > a.length ? b : a));
    expect(longest.length).toBeLessThanOrEqual(maxLength as number);
  });
});
