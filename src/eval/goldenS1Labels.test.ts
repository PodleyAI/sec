/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  GOLDEN_S1_LABELS,
  extractorsWithGoldenLabels,
  getGoldenLabels,
  goldenLabelKey,
  isGoldenManagementRow,
  type GoldenRow,
} from "./goldenS1Labels";
import { EVAL_EXTRACTORS } from "./fixtures";
import { loadRealS1Sections } from "./realSections";
import { isOwnershipGroupSubtotal } from "../sec/forms/registration-statements/s1/sectionExtractors";
import { normalizeManagementTitles } from "../sec/forms/registration-statements/s1/normalizeTitle";

/**
 * Derived, not hardcoded: labeling a new extractor must automatically pull it
 * under the coverage guard below. The previous constant meant a half-labeled
 * extractor — some filings done, some not — passed silently, which is the exact
 * gap that let `--reference golden` report 99% while scoring 2 of 13 extractors.
 */
const LABELED_EXTRACTORS = extractorsWithGoldenLabels();

/** Entries for one extractor, as [key, rows] pairs. */
const entriesFor = (extractor: string): [string, readonly GoldenRow[]][] =>
  Object.entries(GOLDEN_S1_LABELS).filter(([k]) => k.endsWith(`::${extractor}`));

const extractorOf = (key: string): string => key.split("::")[1] ?? "";

/**
 * A row's identity for duplicate detection. Uses the extractor's own `keyField`
 * so this works for every shape; the positional extractors (offering-terms,
 * sponsor-promote, executive-compensation) declare no keyField, and for those
 * the whole scored row is the identity — they align by position, so two
 * identical rows really are a duplicate.
 */
function rowKey(extractor: string, row: GoldenRow): string {
  const spec = EVAL_EXTRACTORS[extractor];
  const bag = row as Record<string, unknown>;
  const keyField = spec?.keyField;
  if (keyField && typeof bag[keyField] === "string") return bag[keyField] as string;
  return JSON.stringify(spec ? spec.compareFields.map((f) => bag[f]) : bag);
}

/** The name-ish key for the two hand-written shapes. */
const rowName = (row: GoldenRow): string =>
  isGoldenManagementRow(row) ? row.full_name : String((row as { name?: unknown }).name ?? "");

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
      const keys = rows.map((r) => rowKey(extractorOf(key), r).toLowerCase());
      expect(new Set(keys).size, key).toBe(keys.length);
    }
  });

  // The scorer reads golden rows as plain records and compares only the fields
  // its EVAL_EXTRACTORS entry names, so a row that misspells or omits a scored
  // field is not a type error anywhere — it silently scores as `undefined` and
  // marks a correct model wrong. With most extractors now labeled by hand, that
  // is the single most likely way to author a bad label, and nothing else
  // catches it.
  it("carries exactly the scored fields for its extractor", () => {
    for (const [key, rows] of Object.entries(GOLDEN_S1_LABELS)) {
      const extractor = extractorOf(key);
      const spec = EVAL_EXTRACTORS[extractor];
      expect(spec, `unknown extractor in golden key: ${key}`).toBeDefined();
      for (const row of rows) {
        const present = Object.keys(row as Record<string, unknown>).sort();
        expect(present, `${key} / ${rowKey(extractor, row)}`).toEqual(
          [...spec!.compareFields].sort()
        );
      }
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

  it("never labels two owners as one name", () => {
    // `name` holds exactly one entity. "V-Cube, Inc. and Naoaki Mashita" is a
    // company and a person — two rows. A combined name would also reach the
    // canonical company tier as a single bogus company via the S-1 persist path.
    // A tripwire over hand-authored labels, not a universal rule: a real owner
    // named "Johnson and Johnson" would trip it. If that happens, confirm the
    // cell names ONE entity and relax this — don't just delete the assertion.
    for (const [key, rows] of entriesFor("beneficial-ownership")) {
      for (const row of rows) {
        expect(rowName(row), key).not.toMatch(/\band\b/i);
      }
    }
  });

  it("carries no footnote markers or parenthetical annotations in owner names", () => {
    // The prompt asks for the bare name; a golden label carrying "(3)" or
    // "(our sponsor)" would only align with a model that ignored that.
    //
    // A parenthesized NICKNAME is exempt: the prompt now asks the model to keep
    // it, because it is part of the name and is folded into `middle` as an
    // identity-bearing part (see normalizePerson). A blanket ban on "(" forced
    // "Yong (David) Yan" to be labelled "Yong Yan" — scoring a compliant model
    // wrong, and encoding the loss of the one token that separates people who
    // share a common given name and surname.
    //
    // Deliberately narrow: a single capitalized word, so "(3)", "(our sponsor)"
    // and "(9 individuals)" all still fail.
    const NICKNAME = /^\p{Lu}[\p{L}'’-]*$/u;
    for (const [key, rows] of entriesFor("beneficial-ownership")) {
      for (const row of rows) {
        const name = rowName(row);
        const parentheticals = [...name.matchAll(/\(([^)]*)\)/g)].map((m) => m[1] ?? "");
        for (const inner of parentheticals) {
          expect(inner, `${key}: ${name}`).toMatch(NICKNAME);
        }
      }
    }
  });
});
