/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  REGA_CURRENT_REPORT_REPOSITORY_TOKEN,
  type RegACurrentReport,
} from "../../../storage/reg-a/RegACurrentReportSchema";
import { classifyRegACurrentReport } from "./regACurrentReportItems";

export interface ProcessForm1UArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly filing_date: string;
  readonly file_number: string | null;
  readonly items: string | null;
}

/**
 * Records a Reg A current report (Form 1-U).
 *
 * METADATA-ONLY: nothing here reads the filing document. Every 1-U carries its
 * item codes in the submissions payload, so the event and its date are already
 * known — fetching 11,600 HTML narratives at 8 req/s to learn what EDGAR already
 * told us would cost ~25 minutes of rate-limit budget and add nothing. This
 * mirrors the 25-15 deregistration path, which skips the fetch for the same
 * reason.
 *
 * What that buys is the timeline. `rega_offering_history` is written only by the
 * 1-A family, so a Reg A issuer's public record ends at its last offering
 * amendment however active it has been since — RealtyMogul filed a 1-U ten days
 * ago and its page stopped at 2025.
 *
 * Idempotent: keyed `(cik, accession_number)`, so a replay upserts.
 */
export async function processForm1U(args: ProcessForm1UArgs): Promise<void> {
  const repo = globalServiceRegistry.get(REGA_CURRENT_REPORT_REPOSITORY_TOKEN);

  const report: RegACurrentReport = {
    cik: args.cik,
    accession_number: args.accession_number,
    file_number: args.file_number?.trim() || null,
    filing_date: args.filing_date,
    form: args.form,
    items: args.items?.trim() || null,
    event_type: classifyRegACurrentReport(args.items),
  };

  await repo.put(report);
}
