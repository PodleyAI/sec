/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { chunkRiskFactorText, isRiskCategoryHeading } from "./riskFactorChunks";

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
