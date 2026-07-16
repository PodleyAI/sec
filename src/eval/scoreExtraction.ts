/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Extractor-agnostic scoring of one model's structured extraction against a
 * golden expected set. Both sides are arrays of row objects (a single-object
 * extractor is wrapped as a one-element array; a null result as an empty one).
 *
 * The score is deliberately field-level and forgiving of noise: only the fields
 * a fixture's `expected` rows actually name are compared, so provenance fields
 * (`confidence`, `source_span`, …) never count against a model. Values are
 * normalized (lowercased, whitespace-collapsed, numbers stringified) before
 * comparison so trivial formatting differences are not penalized.
 */

import { foldTypographicPunctuation } from "../util/dataCleaningUtils";

/** One field-level disagreement on a row that matched between candidate and expected. */
export interface FieldMismatch {
  /** Identifies the row: its `keyField` value, or `#<index>` under positional alignment. */
  readonly key: string;
  readonly field: string;
  /** Raw (un-normalized) expected value, stringified. */
  readonly expected: string;
  /** Raw (un-normalized) candidate value, stringified. */
  readonly got: string;
}

/**
 * The concrete disagreements behind the aggregate score, for display after an
 * eval: expected rows the candidate never produced, distinct candidate rows the
 * expected set never had (hallucinations), and per-field value mismatches on the
 * rows that did align. Keys are `keyField` values (or `#<index>` positionally).
 */
export interface ExtractionDiff {
  readonly missing: readonly string[];
  readonly extra: readonly string[];
  readonly mismatches: readonly FieldMismatch[];
}

export interface ExtractionScore {
  /**
   * Primary correctness signal in [0,1]: the F1 of field-value precision and
   * recall over matched rows, so it drops both when the model MISSES an expected
   * value and when it INVENTS one (an extra `titles` role, a wrong scalar). A
   * pure-recall score would let a model that over-produces still reach 1.0.
   * (Whole invented *rows* are penalized separately by {@link precision}.)
   */
  readonly score: number;
  /** Fraction of expected rows matched to a candidate row. */
  readonly entityRecall: number;
  /** Matched rows / distinct candidate rows — drops when the model invents extra rows. */
  readonly precision: number;
  readonly matchedItems: number;
  readonly expectedItems: number;
  /** Raw candidate row count, before de-duplication. */
  readonly candidateItems: number;
  /**
   * Distinct candidate rows after collapsing repeats on `keyField` (equals
   * {@link candidateItems} when no `keyField` is given). This is the precision
   * denominator: a model that emits the same entity twice is over-producing
   * *rows*, not inventing distinct hallucinations, so duplicates should not be
   * double-counted against it.
   */
  readonly candidateDistinct: number;
  readonly matchedFieldValues: number;
  readonly expectedFieldValues: number;
  /**
   * Candidate field-values produced within matched rows (the F1 precision
   * denominator): for an array field the count of distinct candidate elements,
   * for a scalar 1 when non-empty. Exceeds {@link matchedFieldValues} when the
   * model over-produces (invents roles), which is what pulls {@link score} below
   * pure recall.
   */
  readonly candidateFieldValues: number;
  /** The concrete row/field disagreements behind the aggregates, for display. */
  readonly diff: ExtractionDiff;
}

export interface ScoreOptions {
  /**
   * Field used to align candidate rows with expected rows (e.g. `full_name`).
   * When omitted, rows are aligned by position — right for single-object
   * extractors and order-stable lists.
   */
  readonly keyField?: string;
  /** Restrict comparison to these fields; defaults to the keys present on each expected row. */
  readonly fields?: readonly string[];
}

function normalize(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return (
    // Fold typographic punctuation to ASCII so two models that render the same
    // name with different quote/dash glyphs still align (sonnet's curly
    // `D’Angelo` vs haiku's straight `D'Angelo`) — shares the production
    // name-normalization helper so eval and resolver agree.
    foldTypographicPunctuation(String(value))
      .toLowerCase()
      // Drop punctuation that doesn't change identity but varies by model:
      // a comma (e.g. "Frank Martire, III" vs "Frank Martire III") and a period
      // that isn't a decimal point (initials / suffix: "Richard J. Boyle, Jr."
      // vs "Richard J Boyle Jr"). A period flanked by digits ("10.00") is kept.
      .replace(/,/g, "")
      .replace(/(?<!\d)\.|\.(?!\d)/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function asRow(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Raw (un-normalized) display string for a field value; "" for null/undefined.
 * An array is rendered as a bracketed, quoted list (`["Chairman", "Director"]`)
 * so a multi-element array is visually distinct from a single string that merely
 * contains a comma — otherwise `["CFO", "VP Finance"]` and `["CFO, VP Finance"]`
 * would look identical in a diff.
 */
function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(String(v))).join(", ")}]`;
  return String(value);
}

/**
 * Normalized set of an array-valued field (e.g. a person's `titles` roles),
 * coercing a scalar to a one-element set and dropping empties. Used to score a
 * multi-valued field per element so a model that finds some of a person's roles
 * gets partial credit.
 */
function toValueSet(value: unknown): Set<string> {
  const items = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return new Set(items.map(normalize).filter((s) => s !== ""));
}

/** Label a row for diff output: its `keyField` value, else `#<index>` positionally. */
function rowKey(row: Record<string, unknown>, index: number, keyField: string | undefined): string {
  if (!keyField) return `#${index}`;
  const raw = displayValue(row[keyField]);
  return raw === "" ? `#${index}` : raw;
}

/** Fields to compare for one expected row: explicit `fields`, else its own keys. */
function fieldsFor(expectedRow: Record<string, unknown>, opts: ScoreOptions): string[] {
  return opts.fields ? [...opts.fields] : Object.keys(expectedRow);
}

/**
 * Collapse rows that share a normalized `keyField` value, keeping the first
 * occurrence. Real extractors (especially small local models on long sections)
 * emit the same entity multiple times; those repeats should count once — both
 * when they inflate the candidate set (precision denominator) and when the
 * reference itself repeats an entity (recall denominator). With no `keyField`
 * the list is returned unchanged (positional alignment can't dedupe safely).
 */
function dedupeByKey(
  rows: readonly Record<string, unknown>[],
  keyField: string | undefined
): Record<string, unknown>[] {
  if (!keyField) return [...rows];
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = normalize(row[keyField]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function scoreExtraction(
  candidate: readonly unknown[],
  expected: readonly Record<string, unknown>[],
  opts: ScoreOptions = {}
): ExtractionScore {
  const rawCandidateCount = candidate.length;
  const candidateRows = dedupeByKey(candidate.map(asRow), opts.keyField);
  const expectedRows = dedupeByKey(expected as readonly Record<string, unknown>[], opts.keyField);
  const used = new Array<boolean>(candidateRows.length).fill(false);

  const findMatch = (expectedRow: Record<string, unknown>, index: number): number => {
    if (!opts.keyField) {
      // Positional alignment.
      return index < candidateRows.length && !used[index] ? index : -1;
    }
    const target = normalize(expectedRow[opts.keyField]);
    return candidateRows.findIndex(
      (row, i) => !used[i] && normalize(row[opts.keyField!]) === target
    );
  };

  let matchedItems = 0;
  let matchedFieldValues = 0;
  let expectedFieldValues = 0;
  let candidateFieldValues = 0;
  const missing: string[] = [];
  const mismatches: FieldMismatch[] = [];

  // An array-valued expected field (e.g. `titles`) is weighted by its element
  // count so each role is a scored unit; a scalar field weighs 1. An empty
  // scalar weighs 0: the reference states nothing to find, so the field is not
  // a unit of recall (see the scalar branch below, which likewise credits no
  // match for it — together they keep `score` a true F1 in [0,1]).
  const fieldWeight = (row: Record<string, unknown>, field: string): number =>
    Array.isArray(row[field])
      ? (row[field] as unknown[]).length
      : normalize(row[field]) === ""
        ? 0
        : 1;

  expectedRows.forEach((expectedRow, index) => {
    const fields = fieldsFor(expectedRow, opts);
    expectedFieldValues += fields.reduce((sum, f) => sum + fieldWeight(expectedRow, f), 0);
    const matchIdx = findMatch(expectedRow, index);
    if (matchIdx < 0) {
      missing.push(rowKey(expectedRow, index, opts.keyField));
      return;
    }
    used[matchIdx] = true;
    matchedItems += 1;
    const candidateRow = candidateRows[matchIdx];
    const key = rowKey(expectedRow, index, opts.keyField);
    for (const field of fields) {
      if (Array.isArray(expectedRow[field])) {
        // Multi-valued field: credit the intersection of role sets, count the
        // candidate's distinct roles for precision, and flag a mismatch when the
        // candidate misses an expected role or invents an extra one.
        const expectedSet = toValueSet(expectedRow[field]);
        const candidateSet = toValueSet(candidateRow[field]);
        let hits = 0;
        for (const role of expectedSet) if (candidateSet.has(role)) hits += 1;
        matchedFieldValues += hits;
        candidateFieldValues += candidateSet.size;
        if (hits < expectedSet.size || candidateSet.size > expectedSet.size) {
          mismatches.push({
            key,
            field,
            expected: displayValue(expectedRow[field]),
            got: displayValue(candidateRow[field]),
          });
        }
      } else {
        // Scalar: a non-empty candidate value is one produced field-value
        // (counts toward precision even when it disagrees).
        const candidateValue = normalize(candidateRow[field]);
        const expectedValue = normalize(expectedRow[field]);
        if (candidateValue !== "") candidateFieldValues += 1;
        // A field BOTH sides leave empty is not scored at all. Crediting a match
        // here while the candidate produced no value added to the F1 numerator
        // and to `expectedFieldValues` but not to `candidateFieldValues`, so the
        // score exceeded 1 and ranked a model that emits nothing above one that
        // fills the field in.
        if (expectedValue === "" && candidateValue === "") continue;
        if (candidateValue === expectedValue) {
          matchedFieldValues += 1;
        } else {
          mismatches.push({
            key,
            field,
            expected: displayValue(expectedRow[field]),
            got: displayValue(candidateRow[field]),
          });
        }
      }
    }
  });

  // Distinct candidate rows never aligned to an expected row are over-production.
  const extra = candidateRows
    .map((row, i) => (used[i] ? null : rowKey(row, i, opts.keyField)))
    .filter((k): k is string => k !== null);

  // F1 over field-values: harmonic balance of recall (matched / expected) and
  // precision (matched / produced). Penalizes misses and invented values alike.
  const fieldTotal = expectedFieldValues + candidateFieldValues;
  return {
    score: fieldTotal === 0 ? 1 : (2 * matchedFieldValues) / fieldTotal,
    entityRecall: expectedRows.length === 0 ? 1 : matchedItems / expectedRows.length,
    precision:
      candidateRows.length === 0
        ? expectedRows.length === 0
          ? 1
          : 0
        : matchedItems / candidateRows.length,
    matchedItems,
    expectedItems: expectedRows.length,
    candidateItems: rawCandidateCount,
    candidateDistinct: candidateRows.length,
    matchedFieldValues,
    expectedFieldValues,
    candidateFieldValues,
    diff: { missing, extra, mismatches },
  };
}
