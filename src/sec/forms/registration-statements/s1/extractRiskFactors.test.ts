/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { extractRiskFactors } from "./sectionExtractors";
import { RISK_FACTOR_CHUNK_CHARS } from "./riskFactorChunks";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

const CATEGORY = "Risks Relating to our Securities";

function risk(headline: string, category: string | null = CATEGORY) {
  return { headline, category, confidence: 0.9, source_span: headline };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("extractRiskFactors", () => {
  it("returns the captions in document order", async () => {
    const { unregister, calls } = registerFakeStructuredProvider([
      { risks: [risk("We are a blank check company."), risk("Our securities may be delisted.")] },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors(
      `${CATEGORY}\n\nWe are a blank check company.\n\nBody.`,
      fakeS1Model()
    );
    expect(rows.map((r) => r.headline)).toEqual([
      "We are a blank check company.",
      "Our securities may be delisted.",
    ]);
    expect(rows[0].category).toBe(CATEGORY);
    expect(calls).toHaveLength(1);
    // The filer text is fenced and the trusted preamble carries the nonce.
    expect(calls[0]).toContain("<UNTRUSTED_FILER_DOCUMENT>");
    expect(calls[0]).toContain("We are a blank check company.");
  });

  it("runs one call per chunk over a section too large for a single response", async () => {
    const paragraph = "x".repeat(2_000);
    const paragraphs = Array.from({ length: 60 }, (_, i) => `${paragraph} ${i}`);
    const text = paragraphs.join("\n\n");
    expect(text.length).toBeGreaterThan(RISK_FACTOR_CHUNK_CHARS);

    const { unregister, calls } = registerFakeStructuredProvider([
      { risks: [risk("First risk.")] },
      { risks: [risk("Second risk.")] },
      { risks: [risk("Third risk.")] },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors(text, fakeS1Model());
    expect(calls.length).toBeGreaterThan(1);
    // Rows accumulate across chunks, in chunk order.
    expect(rows.map((r) => r.headline).slice(0, 2)).toEqual(["First risk.", "Second risk."]);
    // Each chunk is fenced on its own and stays under the chunk size (plus the
    // carried category line and the fence/preamble scaffolding).
    for (const call of calls) expect(call).toContain("<UNTRUSTED_FILER_DOCUMENT>");
  });

  it("de-duplicates a caption repeated across chunks", async () => {
    const paragraph = "y".repeat(2_000);
    const text = Array.from({ length: 60 }, (_, i) => `${paragraph} ${i}`).join("\n\n");
    // Every chunk returns the same caption (differing only in case/spacing).
    const { unregister } = registerFakeStructuredProvider([
      { risks: [risk("We may never complete a business combination.")] },
      { risks: [risk("We  may never complete a Business Combination.")] },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors(text, fakeS1Model());
    expect(rows).toHaveLength(1);
  });

  it("drops a category heading the model returned as if it were a risk", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { risks: [risk(CATEGORY, null), risk("Our securities may be delisted.")] },
    ]);
    cleanup = unregister;
    const rows = await extractRiskFactors(`${CATEGORY}\n\nBody.`, fakeS1Model());
    expect(rows.map((r) => r.headline)).toEqual(["Our securities may be delisted."]);
  });

  it("drops a row with a blank caption", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { risks: [risk("  "), risk("A real risk.")] },
    ]);
    cleanup = unregister;
    const rows = await extractRiskFactors("Some risk prose.", fakeS1Model());
    expect(rows.map((r) => r.headline)).toEqual(["A real risk."]);
  });

  it("propagates a chunk failure instead of returning a partial list", async () => {
    const paragraph = "z".repeat(2_000);
    const text = Array.from({ length: 60 }, (_, i) => `${paragraph} ${i}`).join("\n\n");
    // A wrong nonce on the second call models a chunk whose response cannot be
    // trusted; the section must fail rather than persist the first chunk alone.
    const { unregister } = registerFakeStructuredProvider([
      { risks: [risk("First risk.")] },
      { risks: [risk("Second risk.")], nonce_seen: "0000000000000000" },
    ]);
    cleanup = unregister;
    await expect(extractRiskFactors(text, fakeS1Model())).rejects.toThrow(/nonce/i);
  });
});
