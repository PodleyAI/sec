/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";

/**
 * Accession numbers per `in`-list query — see `MAX_IDS_PER_QUERY` in
 * `PersonObservationTitleRepo` for the rationale (SQLite binds one bind
 * parameter per value).
 */
const MAX_ACCESSIONS_PER_QUERY = 900;

/**
 * `accession_number -> filing_date`, chunked for the storage layer's `in`-list
 * bind limit.
 *
 * Shared by the junction and person-role projections: both anchor their output
 * on the asserting filing's date rather than the wall clock, and two copies of
 * the chunking would let one of them drift past a backend's bind limit while
 * the other still fits.
 */
export async function loadFilingDates(
  accession_numbers: readonly string[]
): Promise<Map<string, string>> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const distinct = [...new Set(accession_numbers)];
  const byAccession = new Map<string, string>();
  for (let start = 0; start < distinct.length; start += MAX_ACCESSIONS_PER_QUERY) {
    const chunk = distinct.slice(start, start + MAX_ACCESSIONS_PER_QUERY);
    const filings =
      (await filingRepo.query({ accession_number: { value: chunk, operator: "in" } })) ?? [];
    for (const filing of filings) {
      byAccession.set(filing.accession_number, filing.filing_date);
    }
  }
  return byAccession;
}
