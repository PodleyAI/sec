/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { extractRiskFactors, MixedRiskCaptionShapeError } from "./sectionExtractors";
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

  it("fails the section when the model mixes a category heading in with real captions", async () => {
    // The heading is not a risk, but nothing in its SHAPE separates it from a
    // summary bullet — so dropping it is only safe when the whole section is
    // sentence captions. A mixed response is unanswerable and dead-letters.
    const { unregister } = registerFakeStructuredProvider([
      { risks: [risk(CATEGORY, null), risk("Our securities may be delisted.")] },
    ]);
    cleanup = unregister;
    await expect(extractRiskFactors(`${CATEGORY}\n\nBody.`, fakeS1Model())).rejects.toThrow(
      MixedRiskCaptionShapeError
    );
  });

  it("dead-letters a mixed section rather than persisting the one punctuated caption", async () => {
    // The regression the shape rule exists for. A real Item 105(b) summary list
    // whose filer punctuated exactly ONE of 30 bullets: the old all-or-nothing
    // filter kept that single row and dropped the other 29, persisting one
    // caption as if it were the filing's complete risk disclosure.
    const bare = Array.from(
      { length: 29 },
      (_, i) => `Risks related to our business and operations number ${i + 1}`
    );
    const { unregister } = registerFakeStructuredProvider([
      {
        risks: [
          ...bare.map((bullet) => risk(bullet, null)),
          risk("Risks related to our securities and the trust account.", null),
        ],
      },
    ]);
    cleanup = unregister;

    await expect(
      extractRiskFactors(`Summary of Risk Factors\n\n${bare.join("\n\n")}`, fakeS1Model())
    ).rejects.toThrow(MixedRiskCaptionShapeError);
  });

  it("drops a chunk's echo of the heading the chunker prefixed onto it", async () => {
    // The artifact chunking creates, removed at its source instead of by a
    // ratio. chunkRiskFactorText prepends the last category heading to every
    // chunk that starts mid-category, so the model is handed a heading it did
    // not read in the filer's body and invited to echo it back as a row. That
    // one line is the only thing this code inserted, so an EXACT match against
    // it is provably not a caption the filer printed.
    const CATEGORY_LINE = "Risks Relating to our Securities";
    const bodies = Array.from(
      { length: 40 },
      (_, i) =>
        `We may be unable to complete a business combination number ${i + 1}.\n\n${"prose ".repeat(500)}`
    );
    const text = [CATEGORY_LINE, ...bodies].join("\n\n");

    const { unregister, calls } = registerFakeStructuredProvider([
      { risks: [risk("First risk.")] },
      { risks: [risk(CATEGORY_LINE, null), risk("Second risk.")] },
      { risks: [risk(CATEGORY_LINE, null), risk("Third risk.")] },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors(text, fakeS1Model());
    expect(calls.length).toBeGreaterThan(1);
    // Every real caption survives and the injected line never becomes a row —
    // so the shape check that follows sees a homogeneous response and the
    // section is not failed for an artifact of our own chunking.
    expect(rows.map((r) => r.headline)).toEqual(["First risk.", "Second risk.", "Third risk."]);
  });

  it("dead-letters a mixed section instead of silently deleting the heading-shaped minority", async () => {
    // The inverse of the case above, and the reason a ratio cannot stand in for
    // exact echo removal. One chunk, so nothing was injected: these four bare
    // phrases may well be real Item 105(b) summary bullets the filer printed,
    // and nothing in their shape proves otherwise. Deleting them would record
    // 16 of 20 disclosed risks as the filing's complete list, with the section
    // marked resolved.
    const captions = Array.from(
      { length: 16 },
      (_, i) => `Our securities may be delisted for reason ${i + 1}.`
    );
    const bare = [
      "Risks related to our sponsor and management team",
      "Risks related to our securities and the trust account",
      "Risks related to our inability to complete an initial business combination",
      "Risks related to our business and operations",
    ];
    const { unregister } = registerFakeStructuredProvider([
      { risks: [...captions.map((c) => risk(c)), ...bare.map((b) => risk(b, null))] },
    ]);
    cleanup = unregister;

    await expect(extractRiskFactors("Some risk prose.", fakeS1Model())).rejects.toThrow(
      MixedRiskCaptionShapeError
    );
  });

  it("keeps every caption of an all-sentence list, with nothing heading-shaped to drop", async () => {
    // The other homogeneous case, pinned beside the drop: no row is
    // heading-shaped, so the gate is never entered and the list passes through.
    const captions = Array.from(
      { length: 12 },
      (_, i) => `We may be unable to complete our initial business combination number ${i + 1}.`
    );
    const { unregister } = registerFakeStructuredProvider([
      { risks: captions.map((c) => risk(c)) },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors("Some risk prose.", fakeS1Model());
    expect(rows.map((r) => r.headline)).toEqual(captions);
  });

  it("keeps every bullet of an all-bare-phrase summary list", async () => {
    // The preserved case, pinned beside the mixed one: 30 in, 30 out. Nothing
    // about the new rule may narrow a homogeneous summary list.
    const bullets = Array.from(
      { length: 30 },
      (_, i) => `Risks related to our business and operations number ${i + 1}`
    );
    const { unregister } = registerFakeStructuredProvider([
      { risks: bullets.map((bullet) => risk(bullet, null)) },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors(
      `Summary of Risk Factors\n\n${bullets.join("\n\n")}`,
      fakeS1Model()
    );
    expect(rows.map((r) => r.headline)).toEqual(bullets);
  });

  it("keeps bare-phrase captions when the whole section is a summary bullet list", async () => {
    // An Item 105(b) "Summary of Risk Factors" list — which the segmenter accepts
    // as this section, and which is all a filing carrying only the summary has.
    // Every bullet is a bare unpunctuated phrase mentioning "Risks", the same
    // shape as a category heading, so dropping on shape alone empties it.
    const bullets = [
      "Risks related to our inability to complete an initial business combination",
      "Risks related to our sponsor and management team",
      "Risks related to our securities and the trust account",
    ];
    const { unregister } = registerFakeStructuredProvider([
      { risks: bullets.map((bullet) => risk(bullet, null)) },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors(
      `Summary of Risk Factors\n\n${bullets.join("\n\n")}`,
      fakeS1Model()
    );
    expect(rows.map((r) => r.headline)).toEqual(bullets);
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

  it("retries a chunk whose response fails validation, rather than losing the section", async () => {
    // The real regression: one of seven chunks came back missing `nonce_seen`,
    // and the all-or-nothing rule discarded all 112 captions the other six had
    // already produced. StructuredGenerationTask burns two provider calls per
    // attempt, so the first two responses model one failed attempt.
    const { unregister, calls } = registerFakeStructuredProvider([
      {}, // missing required `risks`
      {}, // ... and its internal retry
      { risks: [risk("A real risk.")] },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors("Some risk prose.", fakeS1Model());
    expect(rows.map((r) => r.headline)).toEqual(["A real risk."]);
    expect(calls).toHaveLength(3);
  });

  it("gives up after EXTRACTION_ATTEMPTS so a persistent failure still fails the section", async () => {
    const { unregister } = registerFakeStructuredProvider([{}]); // always invalid
    cleanup = unregister;
    await expect(extractRiskFactors("Some risk prose.", fakeS1Model())).rejects.toThrow();
  });

  it("recovers from a one-off nonce mismatch without losing the section", async () => {
    // A real run returned the expected token shifted one place with a leading
    // zero ("2074bb2368142557" -> "02074bb236814255"). That is a transcription
    // slip, not an injection: the retry plants a fresh nonce, which an injected
    // payload could never echo, so recovering here costs no security.
    const { unregister } = registerFakeStructuredProvider([
      { risks: [risk("A real risk.")], nonce_seen: "0000000000000000" },
      { risks: [risk("A real risk.")] },
    ]);
    cleanup = unregister;

    const rows = await extractRiskFactors("Some risk prose.", fakeS1Model());
    expect(rows.map((r) => r.headline)).toEqual(["A real risk."]);
  });
});
