/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EntityRepo } from "../../../storage/entity/EntityRepo";
import { pendingDealBefore, compareSpacEventOrder } from "../../../storage/spac/spacDealGrouping";
import type { SpacEvent } from "../../../storage/spac/SpacEventSchema";
import { isFirst20FAfterCombination } from "../registration-statements/s1/newcoListing";
import {
  classifyListingRemoval,
  isNearby20F,
  type ListingRemovalKind,
} from "./classifyListingRemoval";

/** A 20-F / 20-F/A filed close enough to this one to be the same close. */
export async function hasNearby20F(cik: number, filingDate: string): Promise<boolean> {
  const entity = new EntityRepo();
  const [annual, amendment] = await Promise.all([
    entity.getFilingsByForm(cik, "20-F"),
    entity.getFilingsByForm(cik, "20-F/A"),
  ]);
  return [...annual, ...amendment].some(
    (f) => f.filing_date != null && f.filing_date !== "" && isNearby20F(filingDate, f.filing_date)
  );
}

/** A 25-NSE / 25-NSE/A filed close enough to this one to be the same close. */
export async function hasNearby25Nse(cik: number, filingDate: string): Promise<boolean> {
  const entity = new EntityRepo();
  const [nse, amendment] = await Promise.all([
    entity.getFilingsByForm(cik, "25-NSE"),
    entity.getFilingsByForm(cik, "25-NSE/A"),
  ]);
  return [...nse, ...amendment].some(
    (f) => f.filing_date != null && f.filing_date !== "" && isNearby20F(filingDate, f.filing_date)
  );
}

/**
 * What a Form 25 / 25-NSE / Form 15 family filing means for this issuer's
 * lifecycle, resolved from the filings around it and the events dated before
 * it. The reading itself is {@link classifyListingRemoval}; this gathers the
 * evidence that reading needs.
 */
export async function resolveListingRemovalKind(args: {
  readonly cik: number;
  readonly form: string;
  readonly filingDate: string;
  readonly accession_number: string;
  readonly ipoDate: string | null;
  readonly events: readonly SpacEvent[];
}): Promise<ListingRemovalKind> {
  const boundary = { event_date: args.filingDate, accession_number: args.accession_number };
  const pending = pendingDealBefore(args.cik, args.events, boundary);
  const hasPriorCompleted = args.events.some(
    (e) =>
      e.event_type === "completed" &&
      e.accession_number !== args.accession_number &&
      compareSpacEventOrder(e, boundary) < 0
  );
  const [nearby20F, nearby25Nse, first20FAfterCombination] = await Promise.all([
    hasNearby20F(args.cik, args.filingDate),
    hasNearby25Nse(args.cik, args.filingDate),
    isFirst20FAfterCombination(args.cik, args.accession_number, args.filingDate),
  ]);
  return classifyListingRemoval({
    form: args.form,
    ipoDate: args.ipoDate,
    filingDate: args.filingDate,
    pendingDeal: pending,
    hasNearby20F: nearby20F,
    hasPriorCompleted,
    hasNearby25Nse: nearby25Nse,
    isFirst20FAfterCombination: first20FAfterCombination,
  });
}

/**
 * Whether replaying this listing-removal filing can still write something.
 *
 * The single predicate `sec spac process` and `sec extractor backfill 25-15`
 * both select on, so the two cannot drift apart. It is MONOTONE: the only way
 * to answer true is that the event the live classifier names is not yet
 * recorded on this accession, and processing the filing records exactly that
 * event — so a processed filing leaves the set.
 *
 * Two shapes answer false because the listing-removal handler would write
 * nothing for them, and re-selecting a filing nothing can be written for is
 * pure waste repeated on every sweep:
 *
 * - a missing `form` or `filing_date` — the handler returns before writing;
 * - a classifier verdict of `ignore`, which covers every annual 20-F (the form
 *   routes here so the FPI CLOSE filing can record a completion) and every
 *   20-F filed once a completion is already on the stream. A de-SPAC'd foreign
 *   private issuer files one of those every year, forever.
 *
 * A selection predicate, not a writer: it reads `spac_event` and the filings
 * around the accession and decides only whether the filing is worth handing
 * back to whichever package writes those events.
 */
export async function listingRemovalNeedsWork(args: {
  readonly cik: number;
  readonly form: string | null;
  readonly filingDate: string | null;
  readonly accession_number: string;
  readonly ipoDate: string | null;
  readonly events: readonly SpacEvent[];
}): Promise<boolean> {
  if (args.form == null || args.form === "") return false;
  if (args.filingDate == null || args.filingDate === "") return false;
  const kind = await resolveListingRemovalKind({
    cik: args.cik,
    form: args.form,
    filingDate: args.filingDate,
    accession_number: args.accession_number,
    ipoDate: args.ipoDate,
    events: args.events,
  });
  if (kind === "ignore") return false;
  return !args.events.some(
    (e) => e.event_type === kind && e.accession_number === args.accession_number
  );
}
