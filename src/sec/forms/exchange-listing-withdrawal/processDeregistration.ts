/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { EntityRepo } from "../../../storage/entity/EntityRepo";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../../storage/spac/SpacCandidateSchema";
import { pendingDealBefore } from "../../../storage/spac/spacDealGrouping";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import {
  classifyListingRemoval,
  isNearby20F,
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
  const pending = pendingDealBefore(args.cik, events, {
    event_date: args.filing_date,
    accession_number: args.accession_number,
  });
  const kind = classifyListingRemoval({
    form: args.form,
    ipoDate: spacRow.ipo_date,
    filingDate: args.filing_date,
    pendingDeal: pending,
    hasNearby20F: await hasNearby20F(args.cik, args.filing_date),
  });
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
