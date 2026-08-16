/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../../../../storage/filing/FilingSchema";

/**
 * Securities Act registration of a business combination (the surviving
 * company's S-4 / F-4 family). A SPAC's own IPO registration is S-1 / F-1.
 */
export const COMBINATION_REGISTRATION_FORMS: ReadonlySet<string> = new Set([
  "S-4",
  "S-4/A",
  "S-4 POS",
  "S-4EF",
  "S-4EF/A",
  "S-4MEF",
  "F-4",
  "F-4/A",
  "F-4 POS",
  "F-4EF",
  "F-4MEF",
]);

/**
 * Exchange Act class registration — listing a class on an exchange (12(b))
 * or quoting it (12(g)). A SPAC files this at IPO; a newco files it at close.
 */
export const EXCHANGE_LISTING_FORMS: ReadonlySet<string> = new Set([
  "8-A12B",
  "8-A12B/A",
  "8-A12G",
  "8-A12G/A",
]);

/**
 * True when this CIK already has both a combination registration and an
 * exchange listing. That pair is how a de-SPAC newco reaches the public
 * markets — and it is what distinguishes Innventure's pubco S-1 (must not
 * mint a `spac` row) from a blank-check IPO that has only 8-A12B.
 */
export async function issuerHasCombinationListing(cik: number): Promise<boolean> {
  const filings = (await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).query({ cik })) ?? [];
  let hasCombination = false;
  let hasListing = false;
  for (const filing of filings) {
    const form = filing.form;
    if (form === null) continue;
    if (COMBINATION_REGISTRATION_FORMS.has(form)) hasCombination = true;
    if (EXCHANGE_LISTING_FORMS.has(form)) hasListing = true;
    if (hasCombination && hasListing) return true;
  }
  return false;
}
