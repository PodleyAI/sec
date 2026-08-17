/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { anchorFieldSpan } from "./anchorFieldSpan";
import { classifySpan, type SpanVerdict } from "./verifySourceSpan";

const MIN_FIELD_HITS = 2;

export interface NumericAnchorField {
  readonly key: string;
  readonly label: string;
}

/**
 * Object-shaped extractors (offering-terms, sponsor-promote) emit one row
 * whose `source_span` is a paraphrase often enough that `classifySpan`
 * wipes the whole section. When at least two of the row's numeric fields
 * still locate in the section text, the figures came from the filing even
 * if the citation did not.
 *
 * A single hit is not enough: `$10` / `10` occurs everywhere in a
 * prospectus, and one coincidental match would persist a hallucinated rest.
 */
export function verifyNumericObjectSpan(
  text: string,
  row: object & { readonly source_span?: string | null | undefined },
  fields: readonly NumericAnchorField[]
): SpanVerdict {
  const spanVerdict = classifySpan(text, row.source_span ?? null);
  if (spanVerdict === "ok") return "ok";
  const rec = row as Record<string, unknown>;
  let hits = 0;
  for (const f of fields) {
    const value = rec[f.key];
    if (value == null) continue;
    if (anchorFieldSpan(text, value, f.label) != null) hits++;
  }
  return hits >= MIN_FIELD_HITS ? "ok" : spanVerdict;
}
