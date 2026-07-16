/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  GOLDEN_S1_LABELS,
  getGoldenLabels,
  goldenLabelKey,
  isGoldenManagementRow,
  type GoldenRow,
} from "./goldenS1Labels";
import { loadRealS1Sections } from "./realSections";
import { isOwnershipGroupSubtotal } from "../sec/forms/registration-statements/s1/sectionExtractors";
import { normalizeManagementTitles } from "../sec/forms/registration-statements/s1/normalizeTitle";

/** The extractors that currently carry golden labels. */
const LABELED_EXTRACTORS = ["management", "beneficial-ownership"] as const;

/** A labeled row's key field, whichever shape it is. */
const rowName = (row: GoldenRow): string => (isGoldenManagementRow(row) ? row.full_name : row.name);

/** Entries for one extractor, as [key, rows] pairs. */
const entriesFor = (extractor: string): [string, readonly GoldenRow[]][] =>
  Object.entries(GOLDEN_S1_LABELS).filter(([k]) => k.endsWith(`::${extractor}`));

describe("goldenS1Labels", () => {
  it("stores titles already in canonical (normalized) form", () => {
    // Candidate rows are normalized before scoring, so a golden title that isn't
    // already canonical would never align. Normalizing a golden title must be a
    // no-op.
    for (const [key, rows] of entriesFor("management")) {
      for (const row of rows) {
        if (!isGoldenManagementRow(row)) continue;
        expect(normalizeManagementTitles([...row.titles]), `${key} / ${row.full_name}`).toEqual([
          ...row.titles,
        ]);
      }
    }
  });

  it("has no duplicate entries within a section", () => {
    for (const [key, rows] of Object.entries(GOLDEN_S1_LABELS)) {
      const names = rows.map((r) => rowName(r).toLowerCase());
      expect(new Set(names).size, key).toBe(names.length);
    }
  });

  it("labels only sections that exist in the committed set", () => {
    const { sections } = loadRealS1Sections([...LABELED_EXTRACTORS]);
    const present = new Set(sections.map((s) => goldenLabelKey(s.filing, s.extractor)));
    for (const key of Object.keys(GOLDEN_S1_LABELS)) {
      expect(present.has(key), `golden key not found in committed sections: ${key}`).toBe(true);
    }
  });

  it.each(LABELED_EXTRACTORS)(
    "covers every committed %s section (so --reference golden scores them all)",
    (extractor) => {
      const { sections } = loadRealS1Sections([extractor]);
      expect(sections.length).toBeGreaterThan(0);
      for (const s of sections) {
        expect(getGoldenLabels(s.filing, s.extractor), `${s.filing} unlabeled`).toBeDefined();
      }
    }
  );

  it("never labels an ownership subtotal row as an owner", () => {
    // The "All officers and directors as a group (N)" row totals the rows above
    // it; the extractor drops it, so golden must not expect it.
    for (const [key, rows] of entriesFor("beneficial-ownership")) {
      for (const row of rows) {
        expect(isOwnershipGroupSubtotal(rowName(row)), `${key} / ${rowName(row)}`).toBe(false);
      }
    }
  });

  it("carries no footnote markers or parenthetical annotations in owner names", () => {
    // The prompt asks for the bare name; a golden label carrying "(3)" or
    // "(our sponsor)" would only align with a model that ignored that.
    for (const [key, rows] of entriesFor("beneficial-ownership")) {
      for (const row of rows) {
        expect(rowName(row), key).not.toMatch(/\(/);
      }
    }
  });
});
