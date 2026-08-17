/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../../../storage/filing/FilingSchema";

/** Securities Act registration of the blank-check IPO, not the combination. */
const REGISTRATION_FAMILY_FORMS: ReadonlySet<string> = new Set([
  "S-1",
  "S-1/A",
  "S-1MEF",
  "F-1",
  "F-1/A",
  "F-1MEF",
  "DRS",
  "DRS/A",
]);

/**
 * True when a `SEC STAFF ACTION` is the last word on an unpriced registration:
 * no later S-1 / F-1 / DRS family filing came back. A comment letter in the
 * middle of review (Iron Horse: staff action, then a new S-1) is not a
 * withdrawal. Form RW always withdraws; this predicate is staff-action only.
 */
export async function staffActionAbandonsRegistration(
  cik: number,
  staffActionDate: string
): Promise<boolean> {
  const filings = (await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).query({ cik })) ?? [];
  return !filings.some((filing) => {
    const form = filing.form;
    if (form === null || !REGISTRATION_FAMILY_FORMS.has(form)) return false;
    const filed = filing.filing_date;
    return filed != null && filed !== "" && filed > staffActionDate;
  });
}
