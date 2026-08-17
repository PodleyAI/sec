/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  REGA_OFFERING_EVENT_REPOSITORY_TOKEN,
  type RegAOfferingEvent,
} from "../../../storage/reg-a/RegAOfferingEventSchema";
import { classifyRegAOfferingEvent } from "./regAOfferingEventTypes";

export interface ProcessRegAOfferingEventArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly filing_date: string;
  readonly file_number: string | null;
}

/**
 * Records an offering-circular supplement (253G1–253G4) or a withdrawal
 * (1-A-W, 1-Z-W).
 *
 * METADATA-ONLY: nothing here reads the filing document, and unusually little is
 * lost by that. The `024-` file number linking the event to its offering arrives
 * in the submissions payload on 100% of these filings, and the rule subsection
 * is the form name — so the two facts a consumer needs are already known. The
 * documents are 1–2 MB of narrative HTML apiece (~8 GB across the corpus) and
 * carry extractable terms in only 13–30% of cases.
 *
 * Idempotent: keyed `(cik, accession_number)`, so a replay upserts.
 *
 * An unrecognised form throws rather than defaulting. Reaching here with one
 * means the dispatch and {@link REGA_OFFERING_EVENT_TYPES} disagree, which is a
 * wiring error no retry fixes — and filing it under a guessed event type would
 * hide that behind plausible-looking rows.
 */
export async function processRegAOfferingEvent({
  cik,
  accession_number,
  form,
  filing_date,
  file_number,
}: ProcessRegAOfferingEventArgs): Promise<void> {
  const event_type = classifyRegAOfferingEvent(form);
  if (event_type === undefined) {
    throw new Error(`No Reg A offering event type registered for form '${form}'`);
  }

  const repo = globalServiceRegistry.get(REGA_OFFERING_EVENT_REPOSITORY_TOKEN);
  const row: RegAOfferingEvent = {
    cik,
    accession_number,
    file_number: file_number?.trim() || null,
    filing_date,
    form,
    event_type,
  };
  await repo.put(row);
}
