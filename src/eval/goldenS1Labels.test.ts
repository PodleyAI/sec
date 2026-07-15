/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { GOLDEN_S1_LABELS, getGoldenLabels, goldenLabelKey } from "./goldenS1Labels";
import { loadRealS1Sections } from "./realSections";
import { normalizeManagementTitles } from "../sec/forms/registration-statements/s1/normalizeTitle";

describe("goldenS1Labels", () => {
  it("stores titles already in canonical (normalized) form", () => {
    // Candidate rows are normalized before scoring, so a golden title that isn't
    // already canonical would never align. Normalizing a golden title must be a
    // no-op.
    for (const [key, rows] of Object.entries(GOLDEN_S1_LABELS)) {
      for (const row of rows) {
        expect(
          normalizeManagementTitles([...row.titles]),
          `${key} / ${row.full_name}`
        ).toEqual([...row.titles]);
      }
    }
  });

  it("has no duplicate people within a section", () => {
    for (const [key, rows] of Object.entries(GOLDEN_S1_LABELS)) {
      const names = rows.map((r) => r.full_name.toLowerCase());
      expect(new Set(names).size, key).toBe(names.length);
    }
  });

  it("labels only filings that exist in the committed management set", () => {
    const { sections } = loadRealS1Sections(["management"]);
    const present = new Set(sections.map((s) => goldenLabelKey(s.filing, s.extractor)));
    for (const key of Object.keys(GOLDEN_S1_LABELS)) {
      expect(present.has(key), `golden key not found in committed sections: ${key}`).toBe(true);
    }
  });

  it("covers every committed management section (so --reference golden scores them all)", () => {
    const { sections } = loadRealS1Sections(["management"]);
    for (const s of sections) {
      expect(getGoldenLabels(s.filing, s.extractor), `${s.filing} unlabeled`).toBeDefined();
    }
  });
});
