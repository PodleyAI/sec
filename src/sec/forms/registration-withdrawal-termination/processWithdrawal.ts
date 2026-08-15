/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../../storage/spac/SpacCandidateSchema";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";

export interface ProcessWithdrawalArgs {
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
 * Record Form RW as a `withdrawal` lifecycle event. Known-SPAC gated: without
 * a spac row the filing still "succeeds" (the forms sweep must not retry every
 * RW forever) but writes nothing. `RW WD` (undo of a withdrawal) is skipped.
 */
export async function processWithdrawal(args: ProcessWithdrawalArgs): Promise<void> {
  if (args.form === "RW WD") return;
  const spacRow = await new SpacRepo().getSpac(args.cik);
  if (!spacRow) {
    if (await isSpacCandidate(args.cik)) {
      console.warn(
        `[${args.form} ${args.accession_number}] CIK ${args.cik} has no SPAC row, so ` +
          `a withdrawal event was dropped. Process the S-1 / 424 for this issuer first, ` +
          `then re-run its Form RW filings.`
      );
    }
    return;
  }
  if (!args.filing_date) return;
  await new SpacReportWriter().recordWithdrawal(args);
}
