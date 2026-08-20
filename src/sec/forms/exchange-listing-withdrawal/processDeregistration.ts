/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { EntityRepo } from "../../../storage/entity/EntityRepo";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../../storage/spac/SpacCandidateSchema";
import { pendingDealBefore, compareSpacEventOrder } from "../../../storage/spac/spacDealGrouping";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import type { SpacEvent } from "../../../storage/spac/SpacEventSchema";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { isFirst20FAfterCombination } from "../registration-statements/s1/newcoListing";
import {
  classifyListingRemoval,
  isNearby20F,
  type ListingRemovalKind,
} from "./classifyListingRemoval";

export interface ProcessDeregistrationArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly filing_date: string;
}

/**
 * Whether the submissions-only SPAC screen has flagged this CIK. Read
 * defensively: the table is optional in a consumer's schema, and a missing
 * screen must silence the warning rather than fail the filing.
 */
async function isSpacCandidate(cik: number): Promise<boolean> {
  try {
    const repo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    return (await repo.get({ cik })) !== undefined;
  } catch {
    return false;
  }
}

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
 * Two shapes answer false because {@link processDeregistration} would write
 * nothing for them, and re-selecting a filing nothing can be written for is
 * pure waste repeated on every sweep:
 *
 * - a missing `form` or `filing_date` — the handler returns before writing;
 * - a classifier verdict of `ignore`, which covers every annual 20-F (the form
 *   routes here so the FPI CLOSE filing can record a completion) and every
 *   20-F filed once a completion is already on the stream. A de-SPAC'd foreign
 *   private issuer files one of those every year, forever.
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

/**
 * Record Form 25 / 25-NSE / Form 15 family as a lifecycle event. Exchange
 * 25-NSE shortly after IPO is `unit_split` (units unbundle; the vehicle
 * keeps searching — a second 25-NSE in that window is still a split).
 * A pending deal that has reached proxy or vote, or an exchange 25-NSE with
 * a nearby Form 20-F, is `completed` (newco / FPI close with no Item 2.01).
 * Everything else is `deregistration`. Known-SPAC gated:
 * without a spac row the filing still "succeeds" (the forms sweep must not
 * retry every 15-12G forever) but writes nothing.
 */
export async function processDeregistration(args: ProcessDeregistrationArgs): Promise<void> {
  const repo = new SpacRepo();
  const spacRow = await repo.getSpac(args.cik);
  if (!spacRow) {
    if (await isSpacCandidate(args.cik)) {
      console.warn(
        `[${args.form} ${args.accession_number}] CIK ${args.cik} has no SPAC row, so ` +
          `a deregistration event was dropped. Process the S-1 / 424 for this issuer first, ` +
          `then re-run its Form 25/15 filings.`
      );
    }
    return;
  }
  if (!args.filing_date) return;
  const events = await repo.getEvents(args.cik);
  const kind = await resolveListingRemovalKind({
    cik: args.cik,
    form: args.form,
    filingDate: args.filing_date,
    accession_number: args.accession_number,
    ipoDate: spacRow.ipo_date,
    events,
  });
  if (kind === "ignore") return;
  const writer = new SpacReportWriter();
  if (kind === "unit_split") {
    await writer.recordUnitSplit(args);
    return;
  }
  if (kind === "completed") {
    await writer.recordCompleted(args);
    await writer.recordDeSpacLinkage(args);
    return;
  }
  await writer.recordDeregistration(args);
}
