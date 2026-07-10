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

export interface ExtractionScore {
  /** Primary correctness signal in [0,1]: fraction of expected field-values reproduced. */
  readonly score: number;
  /** Fraction of expected rows matched to a candidate row. */
  readonly entityRecall: number;
  /** Matched rows / candidate rows — drops when the model invents extra rows. */
  readonly precision: number;
  readonly matchedItems: number;
  readonly expectedItems: number;
  readonly candidateItems: number;
  readonly matchedFieldValues: number;
  readonly expectedFieldValues: number;
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
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function asRow(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Fields to compare for one expected row: explicit `fields`, else its own keys. */
function fieldsFor(expectedRow: Record<string, unknown>, opts: ScoreOptions): string[] {
  return opts.fields ? [...opts.fields] : Object.keys(expectedRow);
}

export function scoreExtraction(
  candidate: readonly unknown[],
  expected: readonly Record<string, unknown>[],
  opts: ScoreOptions = {}
): ExtractionScore {
  const candidateRows = candidate.map(asRow);
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

  expected.forEach((expectedRow, index) => {
    const fields = fieldsFor(expectedRow, opts);
    expectedFieldValues += fields.length;
    const matchIdx = findMatch(expectedRow, index);
    if (matchIdx < 0) return;
    used[matchIdx] = true;
    matchedItems += 1;
    const candidateRow = candidateRows[matchIdx];
    for (const field of fields) {
      if (normalize(candidateRow[field]) === normalize(expectedRow[field])) matchedFieldValues += 1;
    }
  });

  return {
    score: expectedFieldValues === 0 ? 1 : matchedFieldValues / expectedFieldValues,
    entityRecall: expected.length === 0 ? 1 : matchedItems / expected.length,
    precision: candidateRows.length === 0 ? (expected.length === 0 ? 1 : 0) : matchedItems / candidateRows.length,
    matchedItems,
    expectedItems: expected.length,
    candidateItems: candidateRows.length,
    matchedFieldValues,
    expectedFieldValues,
  };
}
