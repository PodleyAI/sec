/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  buildExtractionPrompt,
  buildUntrustedPreamble,
  wrapUntrusted,
} from "./sectionExtractors";

describe("buildExtractionPrompt", () => {
  it("joins preamble, instructions, and wrapped section text", () => {
    const instructions = "Extract every director named below.";
    const sectionText = "Jane Doe, Chief Executive Officer.";
    const prompt = buildExtractionPrompt({ instructions, sectionText });
    expect(prompt).toBe(
      `${buildUntrustedPreamble()}\n\n${instructions}\n\n${wrapUntrusted(sectionText)}`
    );
  });

  it("passes nonce into the preamble when provided", () => {
    const prompt = buildExtractionPrompt({
      instructions: "x",
      sectionText: "",
      nonce: "0123456789abcdef",
    });
    expect(prompt).toContain("0123456789abcdef");
    expect(prompt.startsWith(buildUntrustedPreamble("0123456789abcdef"))).toBe(true);
  });
});
