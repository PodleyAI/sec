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
 * Ranked by the EARLIEST {@link SWEEP_PRIORITY} slot any of the form's
 * extractors holds. A single ordered pass can honour only one rank per form,
 * and a form carrying several extractors may have several priorities to choose
 * between — but reading the rank off whichever one happens to lead makes the
 * sweep order depend on registration order, which is the accident this
 * function exists to remove: an id absent from `SWEEP_PRIORITY` (a consumer's
 * narrative reading of an 8-K, say) leading a form would send that whole family
 * to the tail, behind the gated forms that read what it writes. Taking the
 * earliest slot is order-independent and never later than the form's most
 * urgent extractor needs. Forms with no ranked extractor — a form with no
 * registered extractor at all included, which the caller refuses or skips
 * separately — keep their declaration order at the end.
 *
 * Lives in its own module rather than in `extractorIds.ts` beside
 * `SWEEP_PRIORITY` because it reads the form-extractor registry:
 * `extractorIds.ts` is a leaf of constants that the extractors' own storage
 * modules import, so an import back into the registry would close a cycle
 * through `registerFormExtractors`.
 */
export function sortFormsForSweep(forms: readonly string[]): string[] {
  const rank = (form: string): number => {
    let best = SWEEP_PRIORITY.length;
    for (const extractorId of extractorIdsForForm(form)) {
      const i = SWEEP_PRIORITY.indexOf(extractorId);
      if (i !== -1 && i < best) best = i;
    }
    return best;
  };
  return [...forms]
    .map((form, i) => ({ form, i, rank: rank(form) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((e) => e.form);
}
