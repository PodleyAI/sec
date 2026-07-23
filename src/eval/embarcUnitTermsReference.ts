/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import { resolveAsset } from "../util/resolveAsset";
import { fileURLToPath } from "node:url";
const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

/**
 * embarc's hand-curated SPAC unit structure, flattened per origin CIK into
 * `mock_data/embarc-spac-unit-terms.csv` by a one-off extraction script.
 * Independent of our pipeline: embarc curated these by hand from prospectuses,
 * so they serve as the TRUTH when scoring the S-1/424 offering-terms extraction
 * (`sec eval unit-terms`). Never imported into the database.
 */
export interface EmbarcUnitTermsRef {
  readonly cik: number;
  readonly name: string;
  /** Shares per unit (embarc `unit_common`; virtually always 1). */
  readonly unit_common: number | null;
  /** Offering price per unit in dollars (embarc `unit_price`; virtually always 10). */
  readonly unit_price: number | null;
  /** Warrant fraction per unit as curated text, e.g. "1/2". */
  readonly unit_warrant: string | null;
  /** Warrant fraction per unit as a decimal — comparable to `warrant_fraction_per_unit`. */
  readonly warrant_fraction_per_unit: number | null;
  /** Rights per unit as a decimal — comparable to `right_fraction_per_unit`. */
  readonly right_fraction_per_unit: number | null;
  /** Share received per right (embarc `unit_right_to_share`), e.g. 0.1. */
  readonly right_share_conversion: number | null;
  /** Warrants per exercisable whole warrant, curated text (e.g. "1:1"). */
  readonly warrant_ratio: string | null;
  /** Warrant exercise price in dollars (virtually always 11.5). */
  readonly warrant_price: number | null;
}

// `importMetaDir` resolves to `src/eval/` in dev and `dist/eval/` after the
// build (the build-js script copies mock_data alongside), so the first
// candidate covers both. The second candidate is a safety fallback if the
// module ever moves relative to its assets. Resolved lazily so a missing
// CSV doesn't crash unrelated code paths at import time.
function resolveReferencePath(): string {
  return resolveAsset([
    join(importMetaDir, "mock_data/embarc-spac-unit-terms.csv"),
    join(importMetaDir, "../eval/mock_data/embarc-spac-unit-terms.csv"),
  ]);
}

const toNum = (v: string): number | null => (v === "" ? null : Number(v));
const toStr = (v: string): string | null => (v === "" ? null : v);

let cache: Map<number, EmbarcUnitTermsRef> | undefined;

/** Load (and memoize) the reference set, keyed by SPAC origin CIK. */
export function loadEmbarcUnitTermsReference(): Map<number, EmbarcUnitTermsRef> {
  if (cache) return cache;
  const records = parse(readFileSync(resolveReferencePath(), "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  cache = new Map(
    records.map((r) => [
      Number(r.cik),
      {
        cik: Number(r.cik),
        name: r.name,
        unit_common: toNum(r.unit_common),
        unit_price: toNum(r.unit_price),
        unit_warrant: toStr(r.unit_warrant),
        warrant_fraction_per_unit: toNum(r.warrant_fraction_per_unit),
        right_fraction_per_unit: toNum(r.right_fraction_per_unit),
        right_share_conversion: toNum(r.right_share_conversion),
        warrant_ratio: toStr(r.warrant_ratio),
        warrant_price: toNum(r.warrant_price),
      },
    ])
  );
  return cache;
}

/**
 * The expected row `scoreExtraction` compares an extracted offering-terms
 * object against, positionally aligned. Only fields the curated reference
 * actually carries are present — the scorer compares only the keys named on an
 * expected row, so an embarc-null field (e.g. rights on a warrant-only unit)
 * is never scored against the model.
 */
export function embarcExpectedRow(ref: EmbarcUnitTermsRef): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (ref.unit_price != null) row.price_per_unit = ref.unit_price;
  if (ref.warrant_fraction_per_unit != null) {
    row.warrant_fraction_per_unit = ref.warrant_fraction_per_unit;
  }
  if (ref.right_fraction_per_unit != null) {
    row.right_fraction_per_unit = ref.right_fraction_per_unit;
  }
  return row;
}

/** Parse the SPAC origin CIK out of a fixture filename like `s1_1849470_000110...`. */
export function cikFromFilingName(filing: string): number | null {
  const m = filing.match(/^s1_(\d+)_/);
  return m ? Number(m[1]) : null;
}
