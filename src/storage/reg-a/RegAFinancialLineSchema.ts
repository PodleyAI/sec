/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * A single figure from a Reg A annual (1-K) or semiannual (1-SA) financial
 * statement: one line item, in one column, of one statement, of one filing.
 *
 * Reg A carries ZERO XBRL — all 28,041 filings across every Reg A form are
 * untagged, because Reg A issuers are exempt from tagging — so these figures
 * exist nowhere in structured form. They are parsed deterministically out of the
 * report's HTML tables by `parseRegAFinancialStatements`.
 *
 * ## Why the table is tall
 *
 * One row per (statement, line, column) rather than a row per line with an array
 * of values. A statement's column count is filer-chosen and varies (two periods
 * is usual, but a multi-series issuer prints six segment columns), and arrays are
 * the one shape `alignPostgresColumnTypes` cannot migrate — it returns
 * `{kind:"other"}` for them — so a column-per-period table could never be widened
 * in place. Tall also makes the natural query ("this issuer's total assets over
 * time") a plain indexed select. At ~2,300 figures per 60 filings the whole Reg A
 * corpus lands in the low hundreds of thousands of rows.
 *
 * ## What is deliberately NOT here
 *
 * No taxonomy mapping. `label` is the filer's own wording, verbatim — including
 * where the filer is wrong (a real 1-SA labels its INVESTING subtotal "Net cash
 * used in operating activities"). The filing is the body of record; normalizing
 * on the way in would destroy the evidence that the two disagree. Any mapping to
 * a canonical chart of accounts belongs on top of this table, not inside it.
 */
export const RegAFinancialLineSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  accession_number: Type.String({
    maxLength: 25,
    description: "Filing accession number",
  }),
  /**
   * Which statement the figure comes from: `balance_sheet`, `operations`,
   * `cash_flows` or `stockholders_equity`.
   */
  statement_kind: Type.String({
    maxLength: 32,
    description: "balance_sheet | operations | cash_flows | stockholders_equity",
  }),
  /** Position of the line within the statement, in document order. */
  row_index: Type.Integer({ description: "0-based line position within the statement" }),
  /** Position of the column the figure sits in, left to right. */
  column_index: Type.Integer({ description: "0-based column position within the statement" }),

  form: Type.String({ maxLength: 16, description: "1-K, 1-K/A, 1-SA or 1-SA/A" }),
  filing_date: Type.String({ description: "Date the report was filed (YYYY-MM-DD)" }),

  /** The line item exactly as the filer labelled it. Never normalized. */
  label: Type.String({
    maxLength: 512,
    description: "Line item label, verbatim from the filing",
  }),
  /**
   * The column heading as printed — usually a period, but a multi-series issuer
   * heads its columns by segment (`ROCF II Series`, `Consolidated`).
   */
  column_label: TypeNullable(
    Type.String({ maxLength: 256, description: "Column heading, verbatim from the filing" })
  ),
  /**
   * The column heading when it reads as a reporting period, else null.
   *
   * Null covers two real cases, neither of them a parse failure: a statement
   * headed by segment rather than by date, and one that states its period in a
   * caption outside the table (23 of 137 statements in a 60-filing sample). The
   * filing's own `period_of_report` is the fallback, and it belongs to the
   * caller — guessing a date here would invent one.
   */
  period: TypeNullable(
    Type.String({ maxLength: 128, description: "Column heading when it reads as a period" })
  ),
  /**
   * The figure. Null where the row reports nothing for this column — a line item
   * introduced this period has no prior-period value.
   *
   * A dash in the filing means ZERO and is stored as 0, not null: reading it as
   * absent would shift every later column left.
   */
  value: TypeNullable(Type.Number({ description: "The reported figure" })),
  /** True when the report declares itself unaudited — a 1-SA always does. */
  unaudited: Type.Boolean({ description: "Whether the report is unaudited" }),
});

export type RegAFinancialLine = Static<typeof RegAFinancialLineSchema>;

export const RegAFinancialLinePrimaryKeyNames = [
  "accession_number",
  "statement_kind",
  "row_index",
  "column_index",
] as const;

export type RegAFinancialLineRepositoryStorage = ITabularStorage<
  typeof RegAFinancialLineSchema,
  typeof RegAFinancialLinePrimaryKeyNames,
  RegAFinancialLine
>;

export const REGA_FINANCIAL_LINE_REPOSITORY_TOKEN =
  createServiceToken<RegAFinancialLineRepositoryStorage>("sec.storage.regAFinancialLineRepository");
