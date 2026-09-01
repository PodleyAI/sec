/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RegAOfferingHistory } from "../../../storage/reg-a/RegAOfferingHistorySchema";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { parseCikSafely } from "../../../util/parseCik";
import type { FormQualif } from "./Form_QUALIF.schema";

export interface ProcessFormQualifArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly formQualif: FormQualif;
}

/**
 * Records the SEC's qualification of a Reg A offering statement.
 *
 * QUALIF is the Commission's own notice, so its date is authoritative where the
 * issuer-reported `offeringQualificationDate` on a 1-K/1-Z is a recollection —
 * and that field is populated on only ~9% of offering-history rows, against
 * 3,062 QUALIF notices covering 1,383 issuers.
 *
 * Writes an offering-history row rather than touching the mutable `rega_offerings`
 * row, for two reasons. The history table is keyed by accession, so one row per
 * notice falls out naturally and a re-run is an upsert rather than a conflict —
 * and an offering accumulates SEVERAL qualifications over its life (the original
 * 1-A, then each qualified post-qualification amendment), which a single scalar
 * on the offering could not hold.
 *
 * The CIK on the notice is preferred over the filing's own: EDGAR files QUALIF
 * under a Commission accession (`9999999997-…`), and the `<filer><cik>` inside
 * is the ISSUER the qualification belongs to. Falling back to the filing CIK
 * keeps a malformed notice attached to something rather than dropped.
 */
export async function processFormQualif(args: ProcessFormQualifArgs): Promise<void> {
  const { cik, accession_number, filing_date, formQualif } = args;
  const effective = formQualif.effectiveData;
  if (!effective) return;

  const fileNumber = effective.filer?.fileNumber?.trim();
  // Without a file number there is no offering to attach to. The notice is real
  // but unusable, and inventing a key would put it on the wrong offering.
  if (!fileNumber) return;

  const issuerCik = parseCikSafely(effective.filer?.cik) ?? cik;
  const qualificationDate = effective.finalEffectivenessDispDate?.trim() || null;

  const regARepo = new RegAOfferingRepo();
  const history: RegAOfferingHistory = {
    cik: issuerCik,
    file_number: fileNumber,
    accession_number,
    filing_date,
    qualification_date: qualificationDate,
    // Everything else is a filer-reported offering figure that a Commission
    // notice does not carry. Null rather than absent so the row shape matches
    // every other writer's, and a later 1-K/1-Z for the same accession would
    // upsert over it rather than merging two partial rows.
    commence_date: null,
    securities_qualified_sold: null,
    securities_sold: null,
    price_per_security: null,
    aggregate_offering_price: null,
    aggregate_offering_price_holders: null,
    issuer_aggregate_offering: null,
    security_holder_aggregate: null,
    // Only Form 1-A states the offering breakdown; the reporting forms do not.
    qualification_offering_aggregate: null,
    concurrent_offering_aggregate: null,
    total_aggregate_offering: null,
    securities_offered: null,
    outstanding_securities: null,
    estimated_net_amount: null,
    crd_number: null,
  };

  await regARepo.saveOfferingHistory(history);
}
