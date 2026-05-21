/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mapping from EDGAR form code -> `mock_data/<slug>/` directory name for
 * the exempt-offering form fixtures. Both the fixture downloader and the
 * pipeline tests use this map; keeping it here avoids drift between the
 * disk layout and either consumer.
 *
 * Withdrawal-only forms (1-A-W, 1-Z-W) are intentionally absent: EDGAR
 * publishes them as HTML, not XML, so there is no `primary_doc.xml` to
 * parse or store.
 */
export const EXEMPT_OFFERING_FORM_SLUGS = {
  C: "form-c",
  "C/A": "form-c-a",
  "C-W": "form-c-w",
  "C/A-W": "form-c-a-w",
  D: "form-d",
  "D/A": "form-d-a",
  "1-A": "form-1-a",
  "1-A/A": "form-1-a-a",
  "1-A POS": "form-1-a-pos",
  "1-K": "form-1-k",
  "1-K/A": "form-1-k-a",
  "1-Z": "form-1-z",
  "1-Z/A": "form-1-z-a",
} as const satisfies Record<string, string>;

export type ExemptOfferingFormCode = keyof typeof EXEMPT_OFFERING_FORM_SLUGS;
export type ExemptOfferingFormSlug = (typeof EXEMPT_OFFERING_FORM_SLUGS)[ExemptOfferingFormCode];

export const EXEMPT_OFFERING_FORM_CODES = Object.keys(
  EXEMPT_OFFERING_FORM_SLUGS
) as ExemptOfferingFormCode[];

export function isExemptOfferingFormCode(value: string): value is ExemptOfferingFormCode {
  return value in EXEMPT_OFFERING_FORM_SLUGS;
}

export function exemptOfferingFormSlug(code: ExemptOfferingFormCode): ExemptOfferingFormSlug {
  return EXEMPT_OFFERING_FORM_SLUGS[code];
}
