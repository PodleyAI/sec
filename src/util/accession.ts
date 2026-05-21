/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * EDGAR accession-number helpers.
 *
 * SEC accession numbers travel in three shapes:
 *   1. Canonical:  "0001234567-25-000001"  (10-2-6 with dashes)
 *   2. URL-style:  "000123456725000001"     (dashes stripped)
 *   3. Index row:  "edgar/data/{cik}/0001234567-25-000001.txt"
 *
 * The helpers below convert between the three. They live here so the
 * existing fetch tasks, the fixture orchestrator, and tests can all
 * agree on the parse rules.
 */

/**
 * Strip the path prefix and ".txt" suffix from a form.idx `fileName`
 * column to recover the canonical accession (with dashes).
 *   "edgar/data/1959708/0001062993-25-001035.txt" -> "0001062993-25-001035"
 */
export function accessionFromFileName(fileName: string): string {
  const base = fileName.split("/").pop() ?? "";
  return base.replace(/\.txt$/, "");
}

/**
 * Strip the dashes from a canonical accession to produce the URL-style
 * form EDGAR uses in `/Archives/edgar/data/{cik}/{accNoDashes}/...`.
 */
export function accessionWithoutDashes(accession: string): string {
  return accession.replace(/-/g, "");
}

/**
 * Reinsert dashes into a fixture filename's accession. Fixtures are
 * named `000123456725000001-primary_doc.xml` (URL-style) on disk; this
 * recovers the canonical 10-2-6 form so storage code that compares
 * against EDGAR-emitted accessions matches.
 */
export function accessionFromFixtureName(file: string): string {
  const noDashes = file.replace(/-primary_doc\.xml$/, "");
  if (!/^\d{18}$/.test(noDashes)) return noDashes;
  return `${noDashes.slice(0, 10)}-${noDashes.slice(10, 12)}-${noDashes.slice(12, 18)}`;
}
