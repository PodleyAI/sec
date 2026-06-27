/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shared "would this incoming filing regress the mutable current row?" rule.
 *
 * A mutable "current" row (InvestmentOffering / RegAOffering / Portal /
 * Crowdfunding) must reflect the latest filing BY FILING DATE, not by processing
 * order. `existingMarker` is the as-of date the stored row already reflects (its
 * `as_of`, or for Crowdfunding its `filing_date`); `filing_date` is the incoming
 * filing's date. The incoming write is stale — and must be skipped — when:
 *
 * - the existing row carries a known marker (`!= null` and not `""`), AND
 * - the incoming filing is older (`filing_date < marker`) OR undated (`""`).
 *
 * An undated incoming filing cannot be ordered against a dated row, so it is
 * treated as stale (a filer header with no SGML date does not clobber a
 * known-dated row). When the existing row is absent or itself undated, nothing
 * can be regressed and the write applies.
 *
 * Callers must run this read-check-write inside a per-key lock (see
 * {@link KeyedMutex}) so two filings for the same key processed concurrently
 * cannot both read the same prior marker and let the older write land last.
 */
export function isStaleByAsOf(
  existingMarker: string | null | undefined,
  filing_date: string
): boolean {
  return (
    existingMarker != null &&
    existingMarker !== "" &&
    (filing_date === "" || filing_date < existingMarker)
  );
}
