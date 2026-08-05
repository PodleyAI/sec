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
    expect(chunkRiskFactorText(text)).toEqual([text]);
  });

  it("returns nothing for blank text", () => {
    expect(chunkRiskFactorText("   \n\n  ")).toEqual([]);
  });

  it("splits on paragraph boundaries without cutting a paragraph", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `${CAPTION} (paragraph ${i})`);
    const chunks = chunkRiskFactorText(paragraphs.join("\n\n"), 400);
    expect(chunks.length).toBeGreaterThan(1);
    for (const paragraph of paragraphs) {
      expect(chunks.some((c) => c.includes(paragraph)), paragraph).toBe(true);
    }
  });

  it("carries the last category heading into the following chunk", () => {
    const chunks = chunkRiskFactorText(
      [CATEGORY, `${CAPTION} one`, `${CAPTION} two`, `${CAPTION} three`].join("\n\n"),
      CAPTION.length + 40
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.startsWith(CATEGORY)).toBe(true);
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
    expect(chunks[1].startsWith(second)).toBe(true);
    expect(chunks[1]).not.toContain(CATEGORY);
  });

  it("keeps a paragraph larger than the chunk size whole", () => {
    const huge = `${CAPTION} `.repeat(40).trim();
    const chunks = chunkRiskFactorText([huge, CAPTION].join("\n\n"), 200);
    expect(chunks[0]).toBe(huge);
    expect(chunks).toHaveLength(2);
  });
});
