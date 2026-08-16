/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Calendar-day window after IPO during which an exchange 25-NSE is unit
 * separation (units stop trading; shares/warrants/rights continue) rather than
 * a vehicle failure. Typical separation is ~20–52 days; this bound is the
 * ceiling, not the expected lag. A 25-NSE years later is a real delisting.
 */
export const UNIT_SEPARATION_MAX_DAYS_AFTER_IPO = 180;

export type ListingRemovalKind = "unit_split" | "deregistration";

export interface ClassifyListingRemovalArgs {
  readonly form: string;
  readonly ipoDate: string | null;
  readonly filingDate: string;
}

function isExchangeNse(form: string): boolean {
  const f = form.trim().toUpperCase();
  return f === "25-NSE" || f === "25-NSE/A";
}

function calendarDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Form 25 / 25-NSE / Form 15 all remove a listed class, but they are not the
 * same lifecycle event. Exchange 25-NSE shortly after IPO is the units
 * unbundling into shares and warrants/rights — including a second 25-NSE in
 * that window (Nasdaq often files one per class). Issuer Form 25 and the
 * Form 15 family terminate the listing / Exchange Act registration.
 */
export function classifyListingRemoval(args: ClassifyListingRemovalArgs): ListingRemovalKind {
  if (isExchangeNse(args.form) && args.ipoDate != null && args.ipoDate !== "") {
    const days = calendarDaysBetween(args.ipoDate, args.filingDate);
    if (days >= 0 && days <= UNIT_SEPARATION_MAX_DAYS_AFTER_IPO) {
      return "unit_split";
    }
  }
  return "deregistration";
}
