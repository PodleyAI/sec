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
};

export function formToExtractorId(form: string): ExtractorId | undefined {
  return FORM_TO_EXTRACTOR_ID[form];
}
