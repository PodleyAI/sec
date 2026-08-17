/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Form 1-U item codes, per the form's own instructions (17 CFR 239.94).
 *
 * A Reg A current report names its subject by item number, and EDGAR carries
 * those numbers in the submissions payload — so the event is knowable without
 * reading the document.
 */
export const REGA_CURRENT_REPORT_ITEMS = {
  "1": "fundamental_change",
  "2": "bankruptcy",
  "3": "rights_modification",
  "4": "auditor_change",
  "5": "non_reliance",
  "6": "control_change",
  "7": "officer_departure",
  "8": "unregistered_sales",
  // Item 9 is "Other Events". EDGAR emits it sub-numbered (9.1, 9.2) and both
  // mean the same thing for classification; the raw codes are stored beside the
  // classification so the distinction is not destroyed.
  "9": "other",
  "9.1": "other",
  "9.2": "other",
} as const satisfies Record<string, string>;

export type RegACurrentReportEvent =
  (typeof REGA_CURRENT_REPORT_ITEMS)[keyof typeof REGA_CURRENT_REPORT_ITEMS];

/**
 * Significance order, most consequential first.
 *
 * A filing may carry several items — `1,9.1` is common — and the row holds one
 * classification, so it has to choose. Ranking rather than taking the first
 * listed: EDGAR orders items numerically, so "first" would mean a filing
 * reporting BOTH a bankruptcy and an other-event classifies on whichever
 * happens to have the lower number, which is not a judgement about importance.
 *
 * The order is by consequence to a holder of the security: the issuer failing,
 * then changing hands, then changing fundamentally, then its financials
 * becoming unreliable, then the machinery around them.
 */
const SIGNIFICANCE: readonly RegACurrentReportEvent[] = [
  "bankruptcy",
  "control_change",
  "fundamental_change",
  "non_reliance",
  "auditor_change",
  "rights_modification",
  "officer_departure",
  "unregistered_sales",
  "other",
] as const;

/**
 * Classifies a comma-joined EDGAR item list into the filing's single most
 * significant event.
 *
 * Returns `other` for an empty, absent or wholly unrecognised list rather than
 * throwing: the row's DATE is its main value, and refusing to record a filing
 * because a future item code is unknown would reintroduce exactly the blind spot
 * this table exists to close. An unknown code is preserved verbatim in `items`.
 */
export function classifyRegACurrentReport(items: string | null | undefined): RegACurrentReportEvent {
  if (!items) return "other";
  const codes = items
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");

  const mapped = codes
    .map((c) => REGA_CURRENT_REPORT_ITEMS[c as keyof typeof REGA_CURRENT_REPORT_ITEMS])
    .filter((e): e is RegACurrentReportEvent => e !== undefined);

  if (mapped.length === 0) return "other";

  let best = mapped[0];
  for (const event of mapped) {
    if (SIGNIFICANCE.indexOf(event) < SIGNIFICANCE.indexOf(best)) best = event;
  }
  return best;
}

/** True when the filing reports something other than a bare "Other Events". */
export function isSubstantiveRegACurrentReport(event: RegACurrentReportEvent): boolean {
  return event !== "other";
}
