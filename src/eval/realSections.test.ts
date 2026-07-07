/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { loadRealS1Sections } from "./realSections";

describe("loadRealS1Sections", () => {
  it("extracts non-empty management sections from committed real S-1 HTML", () => {
    const { sections } = loadRealS1Sections(["management"]);
    // The committed corpus has several S-1s with a management section.
    expect(sections.length).toBeGreaterThanOrEqual(3);
    for (const s of sections) {
      expect(s.extractor).toBe("management");
      expect(s.text.trim().length).toBeGreaterThan(0);
      expect(s.filing).toMatch(/^s1_/);
    }
  });

  it("returns nothing for an extractor with no mapped section", () => {
    const { sections } = loadRealS1Sections(["not-a-real-extractor"]);
    expect(sections).toHaveLength(0);
  });
});
