/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../../storage/spac/SpacCandidateSchema";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { classifyListingRemoval } from "./classifyListingRemoval";

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

/**
 * Record Form 25 / 25-NSE / Form 15 family as a lifecycle event. Exchange
 * 25-NSE shortly after IPO is `unit_split` (units unbundle; the vehicle
 * keeps searching — a second 25-NSE in that window is still a split).
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
  const kind = classifyListingRemoval({
    form: args.form,
    ipoDate: spacRow.ipo_date,
    filingDate: args.filing_date,
  });
  const writer = new SpacReportWriter();
  if (kind === "unit_split") {
    await writer.recordUnitSplit(args);
    return;
  }
  await writer.recordDeregistration(args);
}
