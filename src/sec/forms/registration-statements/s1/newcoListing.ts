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
 * exchange listing dated on or before `asOfFilingDate`. Later S-4 / 8-A12B
 * filings must not reject the original blank-check S-1 (Redwoods, Murphy Canyon).
 */
export async function issuerHasCombinationListing(
  cik: number,
  asOfFilingDate: string
): Promise<boolean> {
  const filings = (await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).query({ cik })) ?? [];
  let hasCombination = false;
  let hasListing = false;
  for (const filing of filings) {
    const form = filing.form;
    if (form === null) continue;
    const filed = filing.filing_date;
    if (filed == null || filed === "" || filed > asOfFilingDate) continue;
    if (COMBINATION_REGISTRATION_FORMS.has(form)) hasCombination = true;
    if (EXCHANGE_LISTING_FORMS.has(form)) hasListing = true;
    if (hasCombination && hasListing) return true;
  }
  return false;
}

function is20FForm(form: string | null): boolean {
  return form === "20-F" || form === "20-F/A";
}

/**
 * True when `accessionNumber` is the earliest 20-F dated on or after this
 * CIK's first S-4 / F-4. That 20-F is the FPI close filing when the shell
 * never files a 25-NSE (NewGenIvf). Later annual 20-Fs are not.
 */
export async function isFirst20FAfterCombination(
  cik: number,
  accessionNumber: string,
  filingDate: string
): Promise<boolean> {
  const filings = (await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).query({ cik })) ?? [];
  let firstCombo: string | null = null;
  for (const filing of filings) {
    const form = filing.form;
    if (form === null || !COMBINATION_REGISTRATION_FORMS.has(form)) continue;
    const filed = filing.filing_date;
    if (filed == null || filed === "" || filed > filingDate) continue;
    if (firstCombo == null || filed < firstCombo) firstCombo = filed;
  }
  if (firstCombo == null) return false;
  const twentyFs = filings.filter((filing) => {
    if (!is20FForm(filing.form)) return false;
    const filed = filing.filing_date;
    return filed != null && filed !== "" && filed >= firstCombo;
  });
  twentyFs.sort(
    (a, b) =>
      (a.filing_date ?? "").localeCompare(b.filing_date ?? "") ||
      a.accession_number.localeCompare(b.accession_number)
  );
  return twentyFs[0]?.accession_number === accessionNumber;
}
