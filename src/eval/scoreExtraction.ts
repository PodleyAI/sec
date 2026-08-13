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

import { normalizeCompany } from "../storage/company/CompanyNormalization";
import { normalizePerson } from "../storage/person/PersonNormalization";
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
  /**
   * Fields whose values are person names (e.g. `full_name`, `person_name`).
   * Alignment, de-duplication, and field equality for these use
   * {@link normalizePerson}'s identity hash so professional credentials
   * ("M.D.", "Ph.D.", "CFA", "PharmD") do not split or fail the same person —
   * they may still appear in printed diffs, but they are not part of the match.
   */
  readonly personNameFields?: readonly string[];
  /**
   * Fields whose values are organization names. Scored through
   * {@link normalizeCompany}, which keeps the parts that identify an
   * organization — the legal form and any roman numeral — so
   * `WAVE Equity Fund, L.P.` and `WAVE Equity Fund, LLC` stay two rows.
   */
  readonly companyNameFields?: readonly string[];
  /**
   * Fields whose values are a person name OR an organization name, decided per
   * row by {@link ScoreOptions.entityKindField}. Requires that field; without
   * it the values fall back to plain normalization.
   *
   * Neither single parser is usable on a mixed field, and the two fail in
   * opposite directions: {@link normalizePerson} reads a legal form as a
   * credential and drops it, collapsing two distinct funds into one row, while
   * {@link normalizeCompany} keeps a person's credential and splits
   * `Isaac Manke` from `Isaac Manke, Ph.D.` — the very split
   * `personNameFields` exists to prevent.
   */
  readonly entityNameFields?: readonly string[];
  /**
   * Field naming a row's entity kind, `"person"` or `"company"` (e.g.
   * `owner_kind`). Only consulted for {@link ScoreOptions.entityNameFields}.
   */
  readonly entityKindField?: string;
}

/** Which normalizer a field's value is scored through, for one row. */
type NameKind = "person" | "company" | "raw";

/**
 * Resolves a field to its normalizer, per row.
 *
 * Per ROW rather than per field, because a mixed extractor's name column holds
 * both kinds and only the row's own discriminator says which — the production
 * observation tier makes the same distinction, routing person mentions through
 * `normalizePerson` and company mentions through `normalizeCompany`.
 */
function makeNameKindResolver(
  opts: ScoreOptions
): (row: Record<string, unknown>, field: string | undefined) => NameKind {
  const person = new Set(opts.personNameFields ?? []);
  const company = new Set(opts.companyNameFields ?? []);
  const entity = new Set(opts.entityNameFields ?? []);
  const kindField = opts.entityKindField;
  return (row, field) => {
    if (!field) return "raw";
    if (person.has(field)) return "person";
    if (company.has(field)) return "company";
    if (entity.has(field) && kindField !== undefined) {
      const kind = row[kindField];
      if (kind === "person") return "person";
      if (kind === "company") return "company";
      // An absent or out-of-enum discriminator is not a licence to guess: a
      // wrong parser corrupts identity in one direction or the other, and plain
      // normalization only ever costs alignment it could have had.
      return "raw";
    }
    return "raw";
  };
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

/**
 * Match key for a field value, in the row it came from. A name field collapses
 * to the production identity hash for its kind — person or company, resolved by
 * {@link makeNameKindResolver} — and everything else uses {@link normalize}.
 *
 * The row is a parameter because the kind can be a property of the row rather
 * than of the field.
 */
function matchKey(
  row: Record<string, unknown>,
  value: unknown,
  field: string | undefined,
  nameKind: (row: Record<string, unknown>, field: string | undefined) => NameKind
): string {
  if (field && typeof value === "string") {
    const kind = nameKind(row, field);
    if (kind === "person") {
      const person = normalizePerson({ name: value });
      if (person) return `person:${person.person_hash_id}`;
    } else if (kind === "company") {
      const company = normalizeCompany(value);
      if (company) return `company:${company.company_hash_id}`;
    }
  }
  return `raw:${normalize(value)}`;
}

function valuesAgree(
  expectedRow: Record<string, unknown>,
  candidateRow: Record<string, unknown>,
  expectedValue: unknown,
  candidateValue: unknown,
  field: string,
  nameKind: (row: Record<string, unknown>, field: string | undefined) => NameKind
): boolean {
  // Each side is keyed in ITS OWN row, so a candidate that also got the
  // discriminator wrong compares as the kind it claimed rather than silently
  // borrowing the reference's. Disagreeing on kind then reads as a mismatch,
  // which is what it is.
  if (nameKind(expectedRow, field) !== "raw" || nameKind(candidateRow, field) !== "raw") {
    return (
      matchKey(expectedRow, expectedValue, field, nameKind) ===
      matchKey(candidateRow, candidateValue, field, nameKind)
    );
  }
  const expectedNorm = normalize(expectedValue);
  const candidateNorm = normalize(candidateValue);
  return numericallyEqual(expectedNorm, candidateNorm) ?? candidateNorm === expectedNorm;
}

function asRow(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** A plain decimal number, optionally signed — the form models emit for numeric fields. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

/** Parsed number for an already-{@link normalize}d value, or null when it isn't one. */
function asNumber(normalized: string): number | null {
  if (!DECIMAL.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Decimal places a numeric literal states: `"0.3333"` → 4, `"10"` → 0. */
function decimalPlaces(literal: string): number {
  const dot = literal.indexOf(".");
  return dot < 0 ? 0 : Math.min(literal.length - dot - 1, 15);
}

/**
 * Numeric equality **at the precision the reference states**: the candidate is
 * rounded to the expected literal's decimal places before comparing, so a model
 * that reports a repeating ratio in full (`0.3333333333` for 1/3) agrees with a
 * golden `0.3333` instead of being scored as a disagreement. Returns null when
 * either side isn't a plain number, leaving the string comparison in charge.
 *
 * The reference's own precision is the tolerance — never the candidate's — so a
 * coarser candidate is still a miss (`10` does not satisfy an expected `10.20`).
 */
function numericallyEqual(expectedValue: string, candidateValue: string): boolean | null {
  const expectedNum = asNumber(expectedValue);
  const candidateNum = asNumber(candidateValue);
  if (expectedNum === null || candidateNum === null) return null;
  const places = decimalPlaces(expectedValue);
  return Number(candidateNum.toFixed(places)) === Number(expectedNum.toFixed(places));
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
  keyField: string | undefined,
  nameKind: (row: Record<string, unknown>, field: string | undefined) => NameKind
): Record<string, unknown>[] {
  if (!keyField) return [...rows];
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const key = matchKey(row, row[keyField], keyField, nameKind);
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
  const nameKind = makeNameKindResolver(opts);
  const rawCandidateCount = candidate.length;
  const candidateRows = dedupeByKey(candidate.map(asRow), opts.keyField, nameKind);
  const expectedRows = dedupeByKey(
    expected as readonly Record<string, unknown>[],
    opts.keyField,
    nameKind
  );
  const used = new Array<boolean>(candidateRows.length).fill(false);

  const findMatch = (expectedRow: Record<string, unknown>, index: number): number => {
    if (!opts.keyField) {
      // Positional alignment.
      return index < candidateRows.length && !used[index] ? index : -1;
    }
    const target = matchKey(expectedRow, expectedRow[opts.keyField], opts.keyField, nameKind);
    return candidateRows.findIndex(
      (row, i) => !used[i] && matchKey(row, row[opts.keyField!], opts.keyField, nameKind) === target
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
        const candidateRaw = candidateRow[field];
        const expectedRaw = expectedRow[field];
        const candidateValue = normalize(candidateRaw);
        const expectedValue = normalize(expectedRaw);
        if (candidateValue !== "") candidateFieldValues += 1;
        // A field BOTH sides leave empty is not scored at all. Crediting a match
        // here while the candidate produced no value added to the F1 numerator
        // and to `expectedFieldValues` but not to `candidateFieldValues`, so the
        // score exceeded 1 and ranked a model that emits nothing above one that
        // fills the field in.
        if (expectedValue === "" && candidateValue === "") continue;
        // Person-name fields compare on identity hash (credentials ignored);
        // numbers agree at the reference's stated precision; everything else is
        // compared as normalized text.
        if (valuesAgree(expectedRow, candidateRow, expectedRaw, candidateRaw, field, nameKind)) {
          matchedFieldValues += 1;
        } else {
          mismatches.push({
            key,
            field,
            expected: displayValue(expectedRaw),
            got: displayValue(candidateRaw),
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
