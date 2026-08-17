/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { RegAFinancialLineRepo } from "../../../storage/reg-a/RegAFinancialLineRepo";
import type { RegAFinancialLine } from "../../../storage/reg-a/RegAFinancialLineSchema";
import type { RegAStatement } from "./regAFinancialStatements";

export interface StoreRegAFinancialsArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly form: string;
  readonly filing_date: string;
  readonly statements: readonly RegAStatement[];
}

/**
 * Persists the financial statements parsed out of a 1-K PART II or 1-SA report.
 *
 * Shared by both forms because the figures are the same shape whatever produced
 * them — the two differ only in which document of the submission carries them
 * (`<TYPE>PART II` versus `<TYPE>1-SA`) and in whether they are audited.
 *
 * Idempotent: the write goes through `replaceForAccession`, which upserts on the
 * positional key and then removes any row a longer prior extract left behind.
 *
 * Returns the number of figures stored — 0 meaning the report carried no
 * parseable statements, which is a legitimate outcome (financials incorporated
 * by reference, or a scanned-PDF report) and deliberately NOT an error. The
 * repo refuses to treat it as a purge.
 */
export async function storeRegAFinancialStatements({
  cik,
  accession_number,
  form,
  filing_date,
  statements,
}: StoreRegAFinancialsArgs): Promise<number> {
  const rows: RegAFinancialLine[] = [];
  for (const statement of statements) {
    statement.rows.forEach((line, rowIndex) => {
      // A row may report fewer figures than the header declares. Iterate the
      // VALUES rather than the columns so a statement with no header at all
      // (its period stated in a caption) still stores its figures.
      line.values.forEach((value, columnIndex) => {
        rows.push({
          cik,
          accession_number,
          statement_kind: statement.kind,
          row_index: rowIndex,
          column_index: columnIndex,
          form,
          filing_date,
          label: line.label.slice(0, 512),
          column_label: statement.columns[columnIndex]?.slice(0, 256) ?? null,
          period: statement.periods[columnIndex]?.slice(0, 128) ?? null,
          value,
          unaudited: statement.unaudited,
        });
      });
    });
  }

  await new RegAFinancialLineRepo().replaceForAccession(accession_number, rows);
  return rows.length;
}
