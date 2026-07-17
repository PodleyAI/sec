/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { extractSpacClassification } from "./sectionExtractors";
import { looksLikeBlankCheck } from "./spacContentHeuristic";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("looksLikeBlankCheck", () => {
  it("fires on dense blank-check vocabulary", () => {
    const text =
      "We are a blank check company incorporated to effect an initial business combination. " +
      "A total of $200,000,000 will be deposited into the trust account.";
    expect(looksLikeBlankCheck(text)).toBe(true);
  });

  it("does not fire on a lone business-combination mention", () => {
    const text =
      "We manufacture industrial pumps. A future business combination could dilute holders " +
      "of our common stock, as described in the risk factors.";
    expect(looksLikeBlankCheck(text)).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(looksLikeBlankCheck("")).toBe(false);
  });

  it("honors a higher minSignals threshold", () => {
    const text = "We are a blank check company with founder shares held by the sponsor.";
    // Three signals: blank check, founder shares, our sponsor? ("the sponsor" != "our sponsor")
    expect(looksLikeBlankCheck(text, 2)).toBe(true);
    expect(looksLikeBlankCheck(text, 5)).toBe(false);
  });
});

describe("extractSpacClassification", () => {
  it("returns a row for a confident SPAC verdict", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        is_spac: true,
        entity_kind: "spac",
        confidence: 0.95,
        source_span: "blank check company",
      },
    ]);
    cleanup = unregister;
    const row = await extractSpacClassification(
      "We are a blank check company with a trust account.",
      fakeS1Model()
    );
    expect(row).not.toBeNull();
    expect(row?.is_spac).toBe(true);
    expect(row?.entity_kind).toBe("spac");
  });

  it("returns null for a confident non-SPAC verdict", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { is_spac: false, entity_kind: "operating", confidence: 0.9, source_span: null },
    ]);
    cleanup = unregister;
    const row = await extractSpacClassification("We manufacture pumps.", fakeS1Model());
    expect(row).toBeNull();
  });

  it("returns null for a shell that is not a blank-check vehicle", async () => {
    // entity_kind "shell" (dormant / reverse-merger shell) is NOT a SPAC — the
    // classifier must not flip is_spac even if the model set is_spac true by
    // mistake; the entity_kind guard drops it.
    const { unregister } = registerFakeStructuredProvider([
      { is_spac: true, entity_kind: "shell", confidence: 0.9, source_span: "shell company" },
    ]);
    cleanup = unregister;
    const row = await extractSpacClassification("A dormant shell company.", fakeS1Model());
    expect(row).toBeNull();
  });
});
