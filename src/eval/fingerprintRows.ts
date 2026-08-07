/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from "node:crypto";

/**
 * Fields that describe where a value came from rather than what it is.
 *
 * Excluded from the content fingerprint on purpose. Re-extracting one real
 * filing three times produced identical risks whose captions were cut at
 * different points — same disclosure, different `source_span` extent — so a
 * fingerprint that includes citations reports churn where the extracted facts
 * actually agreed. Keeping both fingerprints separates "the model found
 * different things" from "the model cited the same thing differently", which
 * need completely different responses.
 */
const CITATION_FIELDS = new Set(["source_span", "confidence"]);

/** Recursively sorts object keys so key order cannot affect the hash. */
function canonicalize(value: unknown, includeCitations: boolean): unknown {
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, includeCitations));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k]) => includeCitations || !CITATION_FIELDS.has(k))
    // Code-unit order, not `localeCompare`: the latter sorts by the runtime's
    // ICU collation, so the same rows would digest differently on two
    // differently-configured machines and a stability report compared across
    // them would show disagreement that is not there.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => [k, canonicalize(v, includeCitations)] as const);
  return Object.fromEntries(entries);
}

/**
 * A stable digest of one extraction's rows, independent of row ORDER and key
 * order. Order is excluded because a model that returns the same set of people
 * in a different sequence has not extracted anything different — and treating
 * that as instability would drown the cases that matter.
 *
 * @param includeCitations when false, `source_span` and `confidence` are
 *   dropped, so the digest covers only the extracted facts.
 */
export function fingerprintRows(
  rows: readonly unknown[],
  includeCitations: boolean = true
): string {
  const canonicalRows = rows
    .map((row) => JSON.stringify(canonicalize(row, includeCitations)))
    .sort();
  return createHash("sha256").update(canonicalRows.join("\n")).digest("hex").slice(0, 12);
}
