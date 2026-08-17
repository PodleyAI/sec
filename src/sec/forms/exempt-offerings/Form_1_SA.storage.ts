/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ParsedForm1SA } from "./Form_1_SA";
import { storeRegAFinancialStatements } from "./regAFinancialStatements.storage";

export interface ProcessForm1SAArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly filing_date: string;
  readonly form1SA: ParsedForm1SA;
}

/**
 * Records a Reg A semiannual report (Form 1-SA).
 *
 * The financial statements are the whole extractor. A 1-SA has no XSD cover
 * page — no issuer block, no tier, no offering figures — so unlike the 1-A/1-K
 * family there is nothing here to observe as an entity or to merge onto the
 * mutable `rega_offerings` row. Writing only the figures is the complete job,
 * not a first slice of it.
 *
 * That also means this extractor never touches `rega_offerings`, so it cannot
 * disturb the `isStaleByAsOf` ordering the 1-A family depends on.
 */
export async function processForm1SA({
  cik,
  accession_number,
  form,
  filing_date,
  form1SA,
}: ProcessForm1SAArgs): Promise<void> {
  await storeRegAFinancialStatements({
    cik,
    accession_number,
    form,
    filing_date,
    statements: form1SA.statements,
  });
}
