/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { extractorIdsForForm } from "../../sec/forms/formExtractors";
import { SWEEP_PRIORITY } from "./extractorIds";

/**
 * Sort forms into {@link SWEEP_PRIORITY} order, stably.
 *
 * Not merely cosmetic: the default form list comes from the form-extractor
 * registry (`ComputeFormsWorklistTask`'s `allForms`) in whatever order each
 * extractor happened to register in — an accident of import order, not a
 * dependency order. Without this sort, a SPAC-gated form (8-K, merger-proxy,
 * 25-15) can land ahead of the registration statement that mints the `spac`
 * row it depends on.
 *
 * Ranked by the FIRST extractor id registered for the form — the one
 * `extractorsForForm` runs first. A single ordered pass can honour only one
 * rank per form, and a form carrying several extractors may have several
 * priorities to choose between. Sweep order is a heuristic (it exists so a
 * gated form lands after the one that mints the row it reads), so there is no
 * right answer among them; ranking by the leading extractor is consistent,
 * cheap to reason about, and beats the registration order it replaces. Forms
 * with no ranked extractor — a form with no registered extractor included,
 * which the caller filters and warns about separately — keep their declaration
 * order at the end.
 *
 * Lives in its own module rather than in `extractorIds.ts` beside
 * `SWEEP_PRIORITY` because it reads the form-extractor registry:
 * `extractorIds.ts` is a leaf of constants that the extractors' own storage
 * modules import, so an import back into the registry would close a cycle
 * through `registerFormExtractors`.
 */
export function sortFormsForSweep(forms: readonly string[]): string[] {
  const rank = (form: string): number => {
    const [leadExtractorId] = extractorIdsForForm(form);
    const i = leadExtractorId === undefined ? -1 : SWEEP_PRIORITY.indexOf(leadExtractorId);
    return i === -1 ? SWEEP_PRIORITY.length : i;
  };
  return [...forms]
    .map((form, i) => ({ form, i, rank: rank(form) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e) => e.form);
}
