/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { GOLDEN_S1_LABELS } from "../../../../eval/goldenS1Labels";
import { chunkRiskFactorText, isRiskCategoryHeading } from "./riskFactorChunks";

/** Every committed `risk-factors` label row, flattened across filings. */
function goldenRiskFactorRows(): { filing: string; headline: string; category: string }[] {
  const out: { filing: string; headline: string; category: string }[] = [];
  for (const [key, rows] of Object.entries(GOLDEN_S1_LABELS)) {
    if (!key.endsWith("::risk-factors")) continue;
    const filing = key.split("::")[0];
    for (const row of rows as readonly Record<string, unknown>[]) {
      out.push({
        filing,
        headline: typeof row.headline === "string" ? row.headline : "",
        category: typeof row.category === "string" ? row.category : "",
      });
    }
  }
  return out;
}

const CATEGORY = "Risks Relating to our Search for, Consummation of, a Business Combination";
const CAPTION =
  "We are a blank check company with no operating history and no revenues, and you have no " +
  "basis on which to evaluate our ability to achieve our business objective.";

describe("isRiskCategoryHeading", () => {
  it("recognizes the category headings real prospectuses print", () => {
    for (const heading of [
      CATEGORY,
      "### Risks Relating to our Securities",
      "General Risk Factors",
      "RISKS RELATED TO GOLD",
      "Risks related to this offering",
    ]) {
      expect(isRiskCategoryHeading(heading), heading).toBe(true);
    }
  });

  it("recognizes a heading whose last word is a dotted initialism", () => {
    // The period closing "U.S." is part of the abbreviation, not sentence
    // punctuation — but the sentence-ending test read it as one, so these
    // headings were classified as captions. That miss is now load-bearing
    // twice over: a heading counted as a caption both escapes the mixed-shape
    // check (persisting as a disclosed risk) and, by making the section look
    // homogeneous in sentences, changes whether a carried-heading echo is kept.
    expect(isRiskCategoryHeading("Risks Related to Our Business in the U.S.")).toBe(true);
    expect(isRiskCategoryHeading("Risks Related to Our Operations in the U.S.")).toBe(true);
    expect(
      isRiskCategoryHeading(
        "Risks Associated with Acquiring and Operating a Business Outside of the U.S."
      )
    ).toBe(true);
    expect(isRiskCategoryHeading("Risks Related to Regulation by the S.E.C.")).toBe(true);
    expect(isRiskCategoryHeading("RISKS RELATED TO OPERATIONS IN THE U.S.")).toBe(true);
  });

  it("does not spend the initialism exception on a sentence caption", () => {
    // The exception reads a closing period as part of an abbreviation, which is
    // only ever right for a line shaped like a heading — one that OPENS on the
    // risk noun. A caption predicates something of a subject and merely
    // mentions risk mid-sentence, so its closing period is real punctuation.
    //
    // Both directions of getting this wrong are expensive. Such a caption
    // becomes the chunker's `lastCategory`, so it is carried into the next
    // chunk and a genuine caption echoing it can be deleted while the section
    // still resolves as complete; and one heading-shaped row among ninety
    // sentence captions makes the response look mixed, throwing
    // MixedRiskCaptionShapeError and version-gating the whole filing's risk
    // disclosure. Declining the exception costs at most one extra persisted row.
    expect(
      isRiskCategoryHeading("We are subject to risks arising from our operations in the U.S.")
    ).toBe(false);
    expect(isRiskCategoryHeading("Our business faces risks in the E.U.")).toBe(false);
    // A real sentence that merely CONTAINS an initialism still ends as a
    // sentence, so it stays a caption.
    expect(isRiskCategoryHeading("We face risks operating in the U.S. market.")).toBe(false);
  });

  it("does not mistake a risk caption or body paragraph for a heading", () => {
    // A caption is a full sentence — it ends in sentence punctuation.
    expect(isRiskCategoryHeading(CAPTION)).toBe(false);
    expect(isRiskCategoryHeading("Our public shareholders may not vote on the combination.")).toBe(
      false
    );
    // Prose that mentions risk but runs long.
    expect(isRiskCategoryHeading(`${CAPTION} ${CAPTION}`)).toBe(false);
    // A heading that never mentions risk belongs to another section.
    expect(isRiskCategoryHeading("Use of Proceeds")).toBe(false);
  });
});

describe("isRiskCategoryHeading over the golden corpus", () => {
  // The unit cases above are hand-written lines; these three assertions hold
  // the predicate against every hand-verified label committed for the real
  // filings. Measured on the corpus as committed: 42 `risk-factors` label
  // arrays (39 non-empty), 3,029 headlines, 102 distinct categories.

  it("classifies no committed caption as a category heading", () => {
    // 0 of 3,029 today, on this branch and on the pre-change predicate alike.
    // It is a ratchet, not a discovery: every caption misread as a heading is a
    // row that either escapes the mixed-shape check or gets carried into the
    // next chunk and deleted as an echo, so this fails the instant anyone
    // widens the predicate — including widening the initialism exception.
    const offenders = goldenRiskFactorRows()
      .filter((r) => r.headline !== "" && isRiskCategoryHeading(r.headline))
      .map((r) => `${r.filing}: ${r.headline}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("classifies every committed category as a category heading", () => {
    // This is what the trailing-initialism exception is FOR. Without it exactly
    // one of the 102 distinct committed categories misses — "Risks Associated
    // with Acquiring and Operating a Business Outside of the U.S." — because
    // the period closing "U.S." was read as sentence punctuation. A category
    // the predicate does not recognize is never carried into the next chunk, so
    // that chunk's captions lose their attribution context.
    const seen = new Set<string>();
    const missed: string[] = [];
    for (const row of goldenRiskFactorRows()) {
      if (row.category === "" || seen.has(row.category)) continue;
      seen.add(row.category);
      if (!isRiskCategoryHeading(row.category)) missed.push(`${row.filing}: ${row.category}`);
    }
    expect(missed, missed.join("\n")).toEqual([]);
  });

  it("keeps bare-phrase captions out of the heading class", () => {
    // 52 committed headlines carry no terminal sentence punctuation, and NONE
    // of them contains the word "risk" — so the risk-word requirement, not the
    // punctuation test, is what keeps them classified as captions.
    //
    // This pins the constraint against relaxing the predicate to punctuation
    // alone. All 52 sit in 14 filings, and every one of those 14 also prints
    // ordinary punctuated captions, so under a punctuation-only predicate
    // `0 < headingLike < body.length` would hold for all 14 —
    // MixedRiskCaptionShapeError on each, permanently version-gating the 1,411
    // hand-verified captions those filings carry between them.
    const bare = goldenRiskFactorRows().filter(
      (r) => r.headline !== "" && !/[.?!;:]$/.test(r.headline.trim())
    );
    expect(bare.length).toBeGreaterThan(0);
    const misclassified = bare
      .filter((r) => isRiskCategoryHeading(r.headline))
      .map((r) => `${r.filing}: ${r.headline}`);
    expect(misclassified, misclassified.join("\n")).toEqual([]);
    expect(bare.filter((r) => /\brisks?\b/i.test(r.headline))).toEqual([]);
  });
});

describe("chunkRiskFactorText", () => {
  it("returns one chunk for a section that fits", () => {
    const text = [CATEGORY, CAPTION, "Body paragraph."].join("\n\n");
    // A single chunk carries no injected heading: nothing precedes it, so every
    // line in it is the filer's.
    expect(chunkRiskFactorText(text)).toEqual([{ text, carriedHeading: null }]);
  });

  it("returns nothing for blank text", () => {
    expect(chunkRiskFactorText("   \n\n  ")).toEqual([]);
  });

  it("splits on paragraph boundaries without cutting a paragraph", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `${CAPTION} (paragraph ${i})`);
    const chunks = chunkRiskFactorText(paragraphs.join("\n\n"), 400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const paragraph of paragraphs) {
      expect(
        chunks.some((c) => c.text.includes(paragraph)),
        paragraph
      ).toBe(true);
    }
  });

  it("carries the last category heading into the following chunk", () => {
    const chunks = chunkRiskFactorText(
      [CATEGORY, `${CAPTION} one`, `${CAPTION} two`, `${CAPTION} three`].join("\n\n"),
      CAPTION.length + 40
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.text.startsWith(CATEGORY)).toBe(true);
    // The first chunk opens on the filer's own heading; only the later ones had
    // one injected, and each says so.
    expect(chunks[0].carriedHeading).toBeNull();
    for (const c of chunks.slice(1)) expect(c.carriedHeading).toBe(CATEGORY);
  });

  it("does not prefix a chunk that already opens on a category heading", () => {
    const second = "Risks Relating to our Securities";
    // Sized so the second category heading is exactly what overflows the first
    // chunk, making it the opening paragraph of the next one.
    const chunks = chunkRiskFactorText(
      [CATEGORY, `${CAPTION} one`, second, `${CAPTION} two`].join("\n\n"),
      CATEGORY.length + CAPTION.length + 10
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[1].text.startsWith(second)).toBe(true);
    expect(chunks[1].text).not.toContain(CATEGORY);
    // Nothing was injected, so there is no echo for the extractor to remove.
    expect(chunks[1].carriedHeading).toBeNull();
  });

  it("keeps a paragraph larger than the chunk size whole", () => {
    const huge = `${CAPTION} `.repeat(40).trim();
    const chunks = chunkRiskFactorText([huge, CAPTION].join("\n\n"), 200);
    expect(chunks[0].text).toBe(huge);
    expect(chunks).toHaveLength(2);
  });

  it("reports the heading it injected so the extractor can un-echo it", () => {
    // The contract the extractor's echo removal depends on: when a chunk
    // reports a carried heading, that heading is literally the chunk's first
    // line. Exact string equality is what makes dropping an echo safe — no
    // caption the model read out of the body can ever match it.
    const chunks = chunkRiskFactorText(
      [CATEGORY, ...Array.from({ length: 8 }, (_, i) => `${CAPTION} (${i})`)].join("\n\n"),
      CAPTION.length + 40
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      if (chunk.carriedHeading === null) continue;
      expect(chunk.text.startsWith(chunk.carriedHeading)).toBe(true);
    }
    expect(chunks.some((c) => c.carriedHeading !== null)).toBe(true);
  });
});
