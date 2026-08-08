/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeForSpanMatch } from "./verifySourceSpan";

/**
 * How much text either side of a located value is kept as its citation. A
 * prospectus states figures inside a labelled table row ("Founder shares |
 * 11,500,000") or a sentence, and both fit comfortably here.
 */
const ANCHOR_CONTEXT_CHARS = 160;

/**
 * The surface forms a numeric value plausibly appears in.
 *
 * A filing writes `$10.00`, `10`, `10.0` and `$10` for the same number, and
 * `30,000,000` for thirty million. A model normalizes all of that to a JS
 * number, so locating the value again means reconstructing the ways a filer
 * might have written it — matching only `String(value)` finds almost nothing.
 *
 * Percentages are the trap worth naming: a model may report 25% as either `25`
 * or `0.25`, and the filing says "25%". Both readings are emitted so a correct
 * extraction is not rejected over a units convention.
 */
export function numericSurfaceForms(value: number): string[] {
  if (!Number.isFinite(value)) return [];
  const forms = new Set<string>();
  const add = (n: number): void => {
    if (!Number.isFinite(n)) return;
    forms.add(String(n));
    forms.add(n.toLocaleString("en-US"));
    if (Number.isInteger(n)) {
      forms.add(`${n}.00`);
      forms.add(`${n.toLocaleString("en-US")}.00`);
    } else {
      forms.add(n.toFixed(2));
      forms.add(Number(n.toFixed(2)).toLocaleString("en-US"));
    }
  };
  add(value);
  // A fraction may be written as a percentage, and vice versa.
  if (value > 0 && value <= 1) add(value * 100);
  if (value >= 1 && value <= 100) add(value / 100);
  return [...forms].filter((f) => f.length > 0);
}

/** Candidate surface forms for any value the extractors produce. */
export function surfaceForms(value: unknown): string[] {
  if (typeof value === "number") return numericSurfaceForms(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length >= 3 ? [trimmed] : [];
  }
  return [];
}

/**
 * Finds `value` in `text` and returns the surrounding passage as its citation.
 *
 * This is the difference between citing an object and citing a field. The
 * model-supplied span proves it read the document; it does not prove that THIS
 * number came from it — a hallucinated figure passes as long as some unrelated
 * sentence verifies. Locating the value proves both, and costs no output
 * tokens because nothing is asked of the model.
 *
 * `label` narrows an ambiguous match: a bare `10` occurs everywhere in a
 * prospectus, so when the field's own name (or a caller-supplied caption) also
 * appears nearby, that occurrence is preferred over the first hit. Without it
 * the citation would often be worse than no citation.
 *
 * Returns null when the value cannot be located — which is itself the useful
 * signal, since a figure absent from the section it was supposedly read from is
 * the definition of a fabricated one.
 */
export function anchorFieldSpan(
  text: string,
  value: unknown,
  label?: string
): string | null {
  const forms = surfaceForms(value);
  if (forms.length === 0) return null;

  const haystack = normalizeForSpanMatch(text);
  const labelNorm = label ? normalizeForSpanMatch(label) : "";
  const labelPositions = labelNorm === "" ? [] : allIndexesOf(haystack, labelNorm);

  // Every occurrence of every surface form, ranked by how close it sits to the
  // field's own label. Without that ranking a bare "10" would cite whichever
  // "10" happens to appear first in a 275k-char section.
  let best: { index: number; length: number; distance: number } | null = null;
  for (const form of forms) {
    const needle = normalizeForSpanMatch(form);
    if (needle.length === 0) continue;
    for (const at of allIndexesOf(haystack, needle)) {
      const distance = nearestDistance(labelPositions, at);
      const better =
        best === null ||
        distance < best.distance ||
        // Same proximity (or no label at all): prefer the longer, more specific
        // surface form, then the earlier occurrence.
        (distance === best.distance &&
          (needle.length > best.length || (needle.length === best.length && at < best.index)));
      if (better) best = { index: at, length: needle.length, distance };
    }
  }
  if (best === null) return null;

  const start = Math.max(0, best.index - ANCHOR_CONTEXT_CHARS);
  const end = Math.min(haystack.length, best.index + best.length + ANCHOR_CONTEXT_CHARS);
  return haystack.slice(start, end).trim();
}

/** Every index at which `needle` occurs in `haystack`. */
function allIndexesOf(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return out;
    out.push(at);
    from = at + 1;
  }
}

/** Distance from `at` to the closest position, or Infinity when there are none. */
function nearestDistance(positions: readonly number[], at: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const p of positions) best = Math.min(best, Math.abs(p - at));
  return best;
}
