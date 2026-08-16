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
 *
 * **An unknown IPO floor does not demote**, matching the 8-K item-1.01 rule
 * where `ipo_date` (falling back to `registration_date`) bounds the
 * definitive-agreement window. `ipo_date` is written only from a 424B1/424B4
 * whose SGML header codes SIC 6770, so a SPAC minted by the S-1 AI content
 * classifier — the SIC-miscoded filer that path exists to catch — structurally
 * never has one. Demoting on its absence turned that vehicle's routine
 * post-IPO unit separation into a permanent `liquidated`.
 *
 * Two things make the allowance safe. It is **self-correcting**: once the 424
 * lands and `ipo_date` appears, the 25-15 backfill descriptor's `filterTodo`
 * re-derives the kind and re-queues the accession, and `recordDeregistration`
 * deletes the sibling `unit_split` on that accession before appending — the
 * correction runs in both directions. And with no `ipo` event on the stream the
 * rollup impact is **inert**: `deriveStatus` reads `unit_split` only inside its
 * `hasIpo` branch, so status stays `registered`, `unit_split_date` is filled,
 * and no IPO is claimed that no filing supports.
 *
 * The allowance is exchange-only. Issuer Form 25 and the whole Form 15 family
 * still deregister whatever the floor, because a real wind-up files exactly
 * those — so the conservative branch loses very little.
 */
export function classifyListingRemoval(args: ClassifyListingRemovalArgs): ListingRemovalKind {
  if (isExchangeNse(args.form)) {
    if (args.ipoDate == null || args.ipoDate === "") return "unit_split";
    const days = calendarDaysBetween(args.ipoDate, args.filingDate);
    if (days >= 0 && days <= UNIT_SEPARATION_MAX_DAYS_AFTER_IPO) {
      return "unit_split";
    }
  }
  return "deregistration";
}
