/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export const EXTRACTOR_IDS = [
  "D",
  "C",
  "CFPORTAL",
  "1-A",
  "1-K",
  "1-Z",
  "3",
  "4",
  "5",
  "144",
  "S-1",
  "424",
  "8-K",
  "merger-proxy",
  "redemption",
  "loi",
  "25-15",
] as const;
export type ExtractorId = (typeof EXTRACTOR_IDS)[number];

/**
 * Maps every supported SEC form symbol (including amendment / withdrawal
 * variants) to the canonical extractor id that handles it. The right-hand
 * values match component_versions.component_id rows seeded by
 * bootstrapExtractorVersions().
 */
export const FORM_TO_EXTRACTOR_ID: Readonly<Record<string, ExtractorId>> = {
  D: "D",
  "D/A": "D",
  C: "C",
  "C/A": "C",
  "C-W": "C",
  "C-U": "C",
  "C-U-W": "C",
  "C/A-W": "C",
  "C-AR": "C",
  "C-AR-W": "C",
  "C-AR/A": "C",
  "C-AR/A-W": "C",
  "C-TR": "C",
  "C-TR-W": "C",
  CFPORTAL: "CFPORTAL",
  "CFPORTAL/A": "CFPORTAL",
  "CFPORTAL-W": "CFPORTAL",
  "1-A": "1-A",
  "1-A/A": "1-A",
  "1-A POS": "1-A",
  "1-K": "1-K",
  "1-K/A": "1-K",
  "1-Z": "1-Z",
  "1-Z/A": "1-Z",
  "3": "3",
  "3/A": "3",
  "4": "4",
  "4/A": "4",
  "5": "5",
  "5/A": "5",
  "144": "144",
  "144/A": "144",
  "S-1": "S-1",
  "S-1/A": "S-1",
  "S-1MEF": "S-1",
  DRS: "S-1",
  "DRS/A": "S-1",
  "F-1": "S-1",
  "F-1/A": "S-1",
  "F-1MEF": "S-1",
  "424A": "424",
  "424B1": "424",
  "424B2": "424",
  "424B3": "424",
  "424B4": "424",
  "424B5": "424",
  "424B7": "424",
  "8-K": "8-K",
  "8-K/A": "8-K",
  DEFM14A: "merger-proxy",
  PREM14A: "merger-proxy",
  DEFM14C: "merger-proxy",
  PREM14C: "merger-proxy",
  DEFR14A: "merger-proxy",
  PRER14A: "merger-proxy",
  // The GENERAL proxy forms. A SPAC's business-combination vote is routinely
  // filed on these rather than on the "M" (merger) variants — 26 Capital's is a
  // plain `DEF 14A` — and skipping them silently drops the proxy stage for the
  // majority of SPACs: across SIC 6770 filers, `DEF 14A` reaches 575 distinct
  // SPACs against `DEFM14A`'s 234, `PRE 14A` 525 and `DEFA14A` 387.
  //
  // Most filings on these forms are NOT merger proxies (annual meetings,
  // director elections, extension votes), which is exactly why routing them
  // here is safe: the merger section is located by the segmenter, so a proxy
  // without one yields no deal rather than an invented one. See
  // `MERGER_PROXY_OPTIONAL_FORMS` — for these forms a missing merger section is
  // the expected case and is skipped quietly instead of dead-lettered.
  "DEF 14A": "merger-proxy",
  "PRE 14A": "merger-proxy",
  // Amendment variants the parser classes also declare; a form the parser
  // supports but the map omits is caught by form-wiring.test.ts.
  "PRE 14A/A": "merger-proxy",
  PRE14A: "merger-proxy",
  PREN14A: "merger-proxy",
  "PREN14A/A": "merger-proxy",
  "PREM14A/A": "merger-proxy",
  // PREC14A/A but NOT PREC14A: the bare code is also declared by
  // Form_PREC14A, which has no parse override and wins resolution, so mapping
  // it would claim a form nothing can parse. The /A amendment is declared only
  // by Form_PRE_14A, which does parse. form-wiring.test.ts checks both
  // directions and is what caught this.
  "PREC14A/A": "merger-proxy",
  DEFA14A: "merger-proxy",
  "DEF 14C": "merger-proxy",
  "PRE 14C": "merger-proxy",
  PREA14C: "merger-proxy",
  // Exchange listing withdrawal (Form 25 / 25-NSE) and Exchange Act
  // deregistration (Form 15 / 15F family). Metadata-only: the filings table
  // already carries cik / form / filing_date, and 25-NSE documents live under
  // the exchange CIK so an issuer-CIK fetch 404s.
  "25": "25-15",
  "25/A": "25-15",
  "25-NSE": "25-15",
  "25-NSE/A": "25-15",
  "15-12B": "25-15",
  "15-12B/A": "25-15",
  "15-12G": "25-15",
  "15-12G/A": "25-15",
  "15-15D": "25-15",
  "15-15D/A": "25-15",
  "15F-12B": "25-15",
  "15F-12B/A": "25-15",
  "15F-12G": "25-15",
  "15F-12G/A": "25-15",
  "15F-15D": "25-15",
  "15F-15D/A": "25-15",
};

/**
 * Forms routed to the merger-proxy extractor on which a MISSING merger section
 * is normal rather than a failure.
 *
 * The "M" forms are merger proxies by definition, so a missing
 * business-combination section there is a real extraction failure worth
 * triaging. The general proxy forms carry every other kind of shareholder vote
 * as well, and most of them legitimately contain no deal — dead-lettering each
 * one would bury the genuine failures under thousands of entries that require
 * no action.
 */
export const MERGER_PROXY_OPTIONAL_FORMS: ReadonlySet<string> = new Set([
  "DEF 14A",
  "PRE 14A",
  "PRE 14A/A",
  "PRE14A",
  "PREN14A",
  "PREN14A/A",
  "PREC14A/A",
  "DEFA14A",
  "DEF 14C",
  "PRE 14C",
  "PREA14C",
]);


/**
 * Short-form registration statements that incorporate an already-filed
 * prospectus by reference (Securities Act Rule 462(b)).
 *
 * They register additional securities for an offering whose full prospectus is
 * already on file, so the document is a cover page and signatures — no
 * management roster, ownership table or risk factors. Sweeping them for those
 * sections dead-letters every one as SECTION_NOT_FOUND and reports the filing
 * `partial`, which is noise: nothing is missing.
 */
export const SECTIONLESS_REGISTRATION_FORMS: ReadonlySet<string> = new Set([
  "S-1MEF",
  "F-1MEF",
]);

export function formToExtractorId(form: string): ExtractorId | undefined {
  return FORM_TO_EXTRACTOR_ID[form];
}
