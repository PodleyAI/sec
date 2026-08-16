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

/**
 * Calendar-day window around a 25-NSE in which a Form 20-F is the FPI close
 * filing (Spring Valley III: Nasdaq 25-NSE 2026-07-10, 20-F 2026-07-16). An
 * annual 20-F does not coincide with a listing removal.
 */
export const FPI_CLOSE_20F_MAX_DAYS = 14;

export type ListingRemovalKind = "unit_split" | "deregistration" | "completed";

export interface ListingRemovalPendingDeal {
  readonly vote_date: string | null;
  readonly proxy_date: string | null;
}

export interface ClassifyListingRemovalArgs {
  readonly form: string;
  readonly ipoDate: string | null;
  readonly filingDate: string;
  readonly pendingDeal?: ListingRemovalPendingDeal | null;
  readonly hasNearby20F?: boolean;
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

function pendingReachedApproval(deal: ListingRemovalPendingDeal | null | undefined): boolean {
  if (deal == null) return false;
  return (deal.vote_date != null && deal.vote_date !== "") || (deal.proxy_date != null && deal.proxy_date !== "");
}

/**
 * Form 25 / 25-NSE / Form 15 all remove a listed class, but they are not the
 * same lifecycle event.
 *
 * Priority:
 * 1. A pending deal that has reached proxy or vote — the listing removal is
 *    post-close housekeeping (newco/FPI closes have no Item 2.01).
 * 2. Exchange 25-NSE shortly after a KNOWN IPO — units unbundle; the vehicle
 *    keeps searching (a second 25-NSE in that window is still a split).
 * 3. Exchange 25-NSE with a nearby Form 20-F — FPI close (the 20-F is the
 *    8-K 2.01 equivalent).
 * 4. Exchange 25-NSE with an UNKNOWN IPO floor — units unbundle. See below.
 * 5. Otherwise issuer Form 25 / Form 15 / a later 25-NSE fail the vehicle.
 *
 * **An unknown IPO floor does not demote**, matching the 8-K item-1.01 rule
 * where `ipo_date` (falling back to `registration_date`) bounds the
 * definitive-agreement window. `ipo_date` is written only from a 424B1/424B4
 * whose SGML header codes SIC 6770, so a SPAC minted by the S-1 AI content
 * classifier — the SIC-miscoded filer that path exists to catch — structurally
 * never has one. Demoting on its absence turned that vehicle's routine
 * post-IPO unit separation into a permanent `liquidated`.
 *
 * The allowance sits at step 4 rather than inside step 2, and the ordering is
 * load-bearing: an FPI close carries no `ipo_date` either, so granting the
 * unknown floor a `unit_split` before the 20-F check would misfile every
 * miscoded FPI close as a unit separation — trading one wrong answer for
 * another. Step 3 gets first refusal on the same filings.
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
  if (pendingReachedApproval(args.pendingDeal)) {
    return "completed";
  }
  const floorKnown = args.ipoDate != null && args.ipoDate !== "";
  if (isExchangeNse(args.form) && floorKnown) {
    const days = calendarDaysBetween(args.ipoDate as string, args.filingDate);
    if (days >= 0 && days <= UNIT_SEPARATION_MAX_DAYS_AFTER_IPO) {
      return "unit_split";
    }
  }
  if (args.hasNearby20F === true && isExchangeNse(args.form)) {
    return "completed";
  }
  if (isExchangeNse(args.form) && !floorKnown) {
    return "unit_split";
  }
  return "deregistration";
}

export function isNearby20F(filingDate: string, twentyFDate: string): boolean {
  const days = Math.abs(calendarDaysBetween(filingDate, twentyFDate));
  return days <= FPI_CLOSE_20F_MAX_DAYS;
}
