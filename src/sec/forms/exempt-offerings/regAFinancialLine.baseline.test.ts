/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { RegAFinancialLineRepo } from "../../../storage/reg-a/RegAFinancialLineRepo";
import type { RegAFinancialLine } from "../../../storage/reg-a/RegAFinancialLineSchema";
import { Form_1_K } from "./Form_1_K";
import { Form_1_SA } from "./Form_1_SA";
import { storeRegAFinancialStatements } from "./regAFinancialStatements.storage";

/**
 * A RECORDING of every `rega_financial_line` row the committed Reg A fixtures
 * produce today, taken from the pipeline that produces them today:
 * `parseRegAFinancialStatements` reached through each form's own parse, then
 * `storeRegAFinancialStatements`.
 *
 * It is not an assertion about what is CORRECT. Whatever the scan emits — a
 * dropped equity line whose label happens to recite a date, a filer's own
 * mislabelled subtotal — is recorded verbatim, because the question it answers
 * is "do the same bytes still come out?" and not "are these the right bytes?".
 * Correctness lives in `regAFinancialStatements.test.ts` and
 * `regAFinancialStatements.storage.test.ts`, which assert named figures and the
 * accounting identities that tie them together.
 *
 * Both forms are covered because they reach the report differently: a 1-K's
 * statements live in a separate `<TYPE>PART II` document of the full
 * submission, while a 1-SA's primary document IS the report.
 *
 * TEMPORARY. Delete once the equivalence it records has been checked.
 */

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "mock_data", "rega-financials", name), "utf-8");

const wrapDocument = (type: string, fileName: string, body: string): string =>
  `<DOCUMENT>\n<TYPE>${type}\n<SEQUENCE>2\n<FILENAME>${fileName}\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n`;

/** The two-document submission a 1-K really is: XSD cover, then the report. */
const SUBMISSION_1K =
  `<SEC-DOCUMENT>\n<SEC-HEADER>\n</SEC-HEADER>\n` +
  fixture("1k-cover-1800055-000121390024095260.sgml") +
  wrapDocument(
    "PART II",
    "ea0219991-1k_caltier.htm",
    fixture("1k-partii-1800055-000121390024095260.htm")
  ) +
  `</SEC-DOCUMENT>`;

/** A 1-SA is handed its report document directly — there is no cover half. */
const REPORT_1SA = fixture("1sa-1838432-000110465924104481.htm");

const NULL_SENTINEL = "<null>";
const FIELD_SEPARATOR = " | ";

const field = (value: string | number | boolean | null): string =>
  value === null ? NULL_SENTINEL : String(value);

/**
 * One line per stored row, every column of the table in schema order.
 *
 * `|` is safe as a separator here and asserted to stay safe: nothing in either
 * filing's labels or column headings contains one, so a line splits back into
 * exactly twelve fields.
 */
const line = (row: RegAFinancialLine): string =>
  [
    row.cik,
    row.accession_number,
    row.statement_kind,
    row.row_index,
    row.column_index,
    row.form,
    row.filing_date,
    row.label,
    row.column_label,
    row.period,
    row.value,
    row.unaudited,
  ]
    .map(field)
    .join(FIELD_SEPARATOR);

/**
 * Sorted by the table's PRIMARY KEY — `accession_number`, `statement_kind`,
 * `row_index`, `column_index` — rather than trusted in the order the storage
 * hands them back. The order rows are written in is the parser's statement
 * order (`REGA_STATEMENT_KINDS`), which is not the key order and is not
 * something a storage backend promises to preserve; sorting makes the recording
 * independent of both.
 */
const recorded = (rows: readonly RegAFinancialLine[]): readonly string[] =>
  [...rows]
    .sort(
      (a, b) =>
        a.accession_number.localeCompare(b.accession_number) ||
        a.statement_kind.localeCompare(b.statement_kind) ||
        a.row_index - b.row_index ||
        a.column_index - b.column_index
    )
    .map(line);

const expected = (blob: string): readonly string[] => blob.trim().split("\n");

/** Every stored figure of CIK 1800055 accession 0001213900-24-095260, in key order. */
const BASELINE_1K = `
1800055 | 0001213900-24-095260 | balance_sheet | 0 | 0 | 1-K | 2024-04-30 | Cash | 2023 | 2023 | 14319 | false
1800055 | 0001213900-24-095260 | balance_sheet | 0 | 1 | 1-K | 2024-04-30 | Cash | 2022 | 2022 | 85932 | false
1800055 | 0001213900-24-095260 | balance_sheet | 1 | 0 | 1-K | 2024-04-30 | Accounts receivable - related parties | 2023 | 2023 | 160817 | false
1800055 | 0001213900-24-095260 | balance_sheet | 1 | 1 | 1-K | 2024-04-30 | Accounts receivable - related parties | 2022 | 2022 | 207066 | false
1800055 | 0001213900-24-095260 | balance_sheet | 2 | 0 | 1-K | 2024-04-30 | Advances to related parties | 2023 | 2023 | 168322 | false
1800055 | 0001213900-24-095260 | balance_sheet | 2 | 1 | 1-K | 2024-04-30 | Advances to related parties | 2022 | 2022 | 342816 | false
1800055 | 0001213900-24-095260 | balance_sheet | 3 | 0 | 1-K | 2024-04-30 | Prepaid expenses and other assets | 2023 | 2023 | 8246 | false
1800055 | 0001213900-24-095260 | balance_sheet | 3 | 1 | 1-K | 2024-04-30 | Prepaid expenses and other assets | 2022 | 2022 | 30000 | false
1800055 | 0001213900-24-095260 | balance_sheet | 4 | 0 | 1-K | 2024-04-30 | Total current assets | 2023 | 2023 | 351704 | false
1800055 | 0001213900-24-095260 | balance_sheet | 4 | 1 | 1-K | 2024-04-30 | Total current assets | 2022 | 2022 | 665814 | false
1800055 | 0001213900-24-095260 | balance_sheet | 5 | 0 | 1-K | 2024-04-30 | Capitalized software development | 2023 | 2023 | 1139953 | false
1800055 | 0001213900-24-095260 | balance_sheet | 5 | 1 | 1-K | 2024-04-30 | Capitalized software development | 2022 | 2022 | 372459 | false
1800055 | 0001213900-24-095260 | balance_sheet | 6 | 0 | 1-K | 2024-04-30 | Total assets | 2023 | 2023 | 1491657 | false
1800055 | 0001213900-24-095260 | balance_sheet | 6 | 1 | 1-K | 2024-04-30 | Total assets | 2022 | 2022 | 1038273 | false
1800055 | 0001213900-24-095260 | balance_sheet | 7 | 0 | 1-K | 2024-04-30 | Accounts payable and accrued expenses | 2023 | 2023 | 836897 | false
1800055 | 0001213900-24-095260 | balance_sheet | 7 | 1 | 1-K | 2024-04-30 | Accounts payable and accrued expenses | 2022 | 2022 | 189225 | false
1800055 | 0001213900-24-095260 | balance_sheet | 8 | 0 | 1-K | 2024-04-30 | Related party notes payable | 2023 | 2023 | 184500 | false
1800055 | 0001213900-24-095260 | balance_sheet | 8 | 1 | 1-K | 2024-04-30 | Related party notes payable | 2022 | 2022 | 138000 | false
1800055 | 0001213900-24-095260 | balance_sheet | 9 | 0 | 1-K | 2024-04-30 | Notes payable | 2023 | 2023 | 175000 | false
1800055 | 0001213900-24-095260 | balance_sheet | 9 | 1 | 1-K | 2024-04-30 | Notes payable | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | balance_sheet | 10 | 0 | 1-K | 2024-04-30 | Total current liabilities | 2023 | 2023 | 1196397 | false
1800055 | 0001213900-24-095260 | balance_sheet | 10 | 1 | 1-K | 2024-04-30 | Total current liabilities | 2022 | 2022 | 327225 | false
1800055 | 0001213900-24-095260 | balance_sheet | 11 | 0 | 1-K | 2024-04-30 | Related party notes payable, net of current portion | 2023 | 2023 | 414000 | false
1800055 | 0001213900-24-095260 | balance_sheet | 11 | 1 | 1-K | 2024-04-30 | Related party notes payable, net of current portion | 2022 | 2022 | 552000 | false
1800055 | 0001213900-24-095260 | balance_sheet | 12 | 0 | 1-K | 2024-04-30 | Notes payable, net of current portion | 2023 | 2023 | 0 | false
1800055 | 0001213900-24-095260 | balance_sheet | 12 | 1 | 1-K | 2024-04-30 | Notes payable, net of current portion | 2022 | 2022 | 145000 | false
1800055 | 0001213900-24-095260 | balance_sheet | 13 | 0 | 1-K | 2024-04-30 | Total liabilities | 2023 | 2023 | 1610397 | false
1800055 | 0001213900-24-095260 | balance_sheet | 13 | 1 | 1-K | 2024-04-30 | Total liabilities | 2022 | 2022 | 1024225 | false
1800055 | 0001213900-24-095260 | balance_sheet | 14 | 0 | 1-K | 2024-04-30 | Additional paid-in capital | 2023 | 2023 | 2822613 | false
1800055 | 0001213900-24-095260 | balance_sheet | 14 | 1 | 1-K | 2024-04-30 | Additional paid-in capital | 2022 | 2022 | 1912478 | false
1800055 | 0001213900-24-095260 | balance_sheet | 15 | 0 | 1-K | 2024-04-30 | Accumulated deficit | 2023 | 2023 | -2917272 | false
1800055 | 0001213900-24-095260 | balance_sheet | 15 | 1 | 1-K | 2024-04-30 | Accumulated deficit | 2022 | 2022 | -1899342 | false
1800055 | 0001213900-24-095260 | balance_sheet | 16 | 0 | 1-K | 2024-04-30 | Total stockholders’ equity (deficit) | 2023 | 2023 | -118740 | false
1800055 | 0001213900-24-095260 | balance_sheet | 16 | 1 | 1-K | 2024-04-30 | Total stockholders’ equity (deficit) | 2022 | 2022 | 14048 | false
1800055 | 0001213900-24-095260 | balance_sheet | 17 | 0 | 1-K | 2024-04-30 | Total liabilities and stockholders’ equity (deficit) | 2023 | 2023 | 1491657 | false
1800055 | 0001213900-24-095260 | balance_sheet | 17 | 1 | 1-K | 2024-04-30 | Total liabilities and stockholders’ equity (deficit) | 2022 | 2022 | 1038273 | false
1800055 | 0001213900-24-095260 | cash_flows | 0 | 0 | 1-K | 2024-04-30 | Net loss | 2023 | 2023 | -1017930 | false
1800055 | 0001213900-24-095260 | cash_flows | 0 | 1 | 1-K | 2024-04-30 | Net loss | 2022 | 2022 | -1606037 | false
1800055 | 0001213900-24-095260 | cash_flows | 1 | 0 | 1-K | 2024-04-30 | Stock-based compensation | 2023 | 2023 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 1 | 1 | 1-K | 2024-04-30 | Stock-based compensation | 2022 | 2022 | 550000 | false
1800055 | 0001213900-24-095260 | cash_flows | 2 | 0 | 1-K | 2024-04-30 | Bad debt | 2023 | 2023 | 91146 | false
1800055 | 0001213900-24-095260 | cash_flows | 2 | 1 | 1-K | 2024-04-30 | Bad debt | 2022 | 2022 | 35861 | false
1800055 | 0001213900-24-095260 | cash_flows | 3 | 0 | 1-K | 2024-04-30 | Accounts receivable - related parties | 2023 | 2023 | -37818 | false
1800055 | 0001213900-24-095260 | cash_flows | 3 | 1 | 1-K | 2024-04-30 | Accounts receivable - related parties | 2022 | 2022 | -129765 | false
1800055 | 0001213900-24-095260 | cash_flows | 4 | 0 | 1-K | 2024-04-30 | Prepaid expenses and other assets | 2023 | 2023 | 30000 | false
1800055 | 0001213900-24-095260 | cash_flows | 4 | 1 | 1-K | 2024-04-30 | Prepaid expenses and other assets | 2022 | 2022 | -25875 | false
1800055 | 0001213900-24-095260 | cash_flows | 5 | 0 | 1-K | 2024-04-30 | Accounts payable and accrued expenses | 2023 | 2023 | 610172 | false
1800055 | 0001213900-24-095260 | cash_flows | 5 | 1 | 1-K | 2024-04-30 | Accounts payable and accrued expenses | 2022 | 2022 | 124198 | false
1800055 | 0001213900-24-095260 | cash_flows | 6 | 0 | 1-K | 2024-04-30 | Net cash used in operating activities | 2023 | 2023 | -324430 | false
1800055 | 0001213900-24-095260 | cash_flows | 6 | 1 | 1-K | 2024-04-30 | Net cash used in operating activities | 2022 | 2022 | -1051618 | false
1800055 | 0001213900-24-095260 | cash_flows | 7 | 0 | 1-K | 2024-04-30 | Capitalized software development | 2023 | 2023 | -113424 | false
1800055 | 0001213900-24-095260 | cash_flows | 7 | 1 | 1-K | 2024-04-30 | Capitalized software development | 2022 | 2022 | -64174 | false
1800055 | 0001213900-24-095260 | cash_flows | 8 | 0 | 1-K | 2024-04-30 | Repayment of related party advances | 2023 | 2023 | 159169 | false
1800055 | 0001213900-24-095260 | cash_flows | 8 | 1 | 1-K | 2024-04-30 | Repayment of related party advances | 2022 | 2022 | 34381 | false
1800055 | 0001213900-24-095260 | cash_flows | 9 | 0 | 1-K | 2024-04-30 | Net cash provided by (used in) investing activities | 2023 | 2023 | 45745 | false
1800055 | 0001213900-24-095260 | cash_flows | 9 | 1 | 1-K | 2024-04-30 | Net cash provided by (used in) investing activities | 2022 | 2022 | -29793 | false
1800055 | 0001213900-24-095260 | cash_flows | 10 | 0 | 1-K | 2024-04-30 | Proceeds from notes payable | 2023 | 2023 | 65000 | false
1800055 | 0001213900-24-095260 | cash_flows | 10 | 1 | 1-K | 2024-04-30 | Proceeds from notes payable | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 11 | 0 | 1-K | 2024-04-30 | Payment of related party notes payable | 2023 | 2023 | -91500 | false
1800055 | 0001213900-24-095260 | cash_flows | 11 | 1 | 1-K | 2024-04-30 | Payment of related party notes payable | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 12 | 0 | 1-K | 2024-04-30 | Payment of notes payable | 2023 | 2023 | -35000 | false
1800055 | 0001213900-24-095260 | cash_flows | 12 | 1 | 1-K | 2024-04-30 | Payment of notes payable | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 13 | 0 | 1-K | 2024-04-30 | Sale of shares of common stock | 2023 | 2023 | 362865 | false
1800055 | 0001213900-24-095260 | cash_flows | 13 | 1 | 1-K | 2024-04-30 | Sale of shares of common stock | 2022 | 2022 | 928244 | false
1800055 | 0001213900-24-095260 | cash_flows | 14 | 0 | 1-K | 2024-04-30 | Repurchase of shares of common stock | 2023 | 2023 | -25000 | false
1800055 | 0001213900-24-095260 | cash_flows | 14 | 1 | 1-K | 2024-04-30 | Repurchase of shares of common stock | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 15 | 0 | 1-K | 2024-04-30 | Offering costs | 2023 | 2023 | -69293 | false
1800055 | 0001213900-24-095260 | cash_flows | 15 | 1 | 1-K | 2024-04-30 | Offering costs | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 16 | 0 | 1-K | 2024-04-30 | Net cash provided by financing activities | 2023 | 2023 | 207072 | false
1800055 | 0001213900-24-095260 | cash_flows | 16 | 1 | 1-K | 2024-04-30 | Net cash provided by financing activities | 2022 | 2022 | 928244 | false
1800055 | 0001213900-24-095260 | cash_flows | 17 | 0 | 1-K | 2024-04-30 | Net change in cash and cash equivalents | 2023 | 2023 | -71613 | false
1800055 | 0001213900-24-095260 | cash_flows | 17 | 1 | 1-K | 2024-04-30 | Net change in cash and cash equivalents | 2022 | 2022 | -153167 | false
1800055 | 0001213900-24-095260 | cash_flows | 18 | 0 | 1-K | 2024-04-30 | Cash and cash equivalents at beginning of year | 2023 | 2023 | 85932 | false
1800055 | 0001213900-24-095260 | cash_flows | 18 | 1 | 1-K | 2024-04-30 | Cash and cash equivalents at beginning of year | 2022 | 2022 | 239099 | false
1800055 | 0001213900-24-095260 | cash_flows | 19 | 0 | 1-K | 2024-04-30 | Cash and cash equivalents at end of year | 2023 | 2023 | 14319 | false
1800055 | 0001213900-24-095260 | cash_flows | 19 | 1 | 1-K | 2024-04-30 | Cash and cash equivalents at end of year | 2022 | 2022 | 85932 | false
1800055 | 0001213900-24-095260 | cash_flows | 20 | 0 | 1-K | 2024-04-30 | Cash paid for income taxes | 2023 | 2023 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 20 | 1 | 1-K | 2024-04-30 | Cash paid for income taxes | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 21 | 0 | 1-K | 2024-04-30 | Cash paid for interest | 2023 | 2023 | 3000 | false
1800055 | 0001213900-24-095260 | cash_flows | 21 | 1 | 1-K | 2024-04-30 | Cash paid for interest | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 22 | 0 | 1-K | 2024-04-30 | Capitalized software development costs incurred as stock-based compensation | 2023 | 2023 | 616570 | false
1800055 | 0001213900-24-095260 | cash_flows | 22 | 1 | 1-K | 2024-04-30 | Capitalized software development costs incurred as stock-based compensation | 2022 | 2022 | 308285 | false
1800055 | 0001213900-24-095260 | cash_flows | 23 | 0 | 1-K | 2024-04-30 | Capitalized software development costs included in accounts payable | 2023 | 2023 | 37500 | false
1800055 | 0001213900-24-095260 | cash_flows | 23 | 1 | 1-K | 2024-04-30 | Capitalized software development costs included in accounts payable | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 24 | 0 | 1-K | 2024-04-30 | Issuance of related party notes for repurchase of member interests | 2023 | 2023 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 24 | 1 | 1-K | 2024-04-30 | Issuance of related party notes for repurchase of member interests | 2022 | 2022 | 690000 | false
1800055 | 0001213900-24-095260 | cash_flows | 25 | 0 | 1-K | 2024-04-30 | Conversion of equity into notes payable | 2023 | 2023 | 0 | false
1800055 | 0001213900-24-095260 | cash_flows | 25 | 1 | 1-K | 2024-04-30 | Conversion of equity into notes payable | 2022 | 2022 | 145000 | false
1800055 | 0001213900-24-095260 | operations | 0 | 0 | 1-K | 2024-04-30 | Revenue - related parties | 2023 | 2023 | 149516 | false
1800055 | 0001213900-24-095260 | operations | 0 | 1 | 1-K | 2024-04-30 | Revenue - related parties | 2022 | 2022 | 72817 | false
1800055 | 0001213900-24-095260 | operations | 1 | 0 | 1-K | 2024-04-30 | Selling, general and administrative | 2023 | 2023 | 918944 | false
1800055 | 0001213900-24-095260 | operations | 1 | 1 | 1-K | 2024-04-30 | Selling, general and administrative | 2022 | 2022 | 572191 | false
1800055 | 0001213900-24-095260 | operations | 2 | 0 | 1-K | 2024-04-30 | Professional and legal | 2023 | 2023 | 205356 | false
1800055 | 0001213900-24-095260 | operations | 2 | 1 | 1-K | 2024-04-30 | Professional and legal | 2022 | 2022 | 933932 | false
1800055 | 0001213900-24-095260 | operations | 3 | 0 | 1-K | 2024-04-30 | Total operating expenses | 2023 | 2023 | 1124300 | false
1800055 | 0001213900-24-095260 | operations | 3 | 1 | 1-K | 2024-04-30 | Total operating expenses | 2022 | 2022 | 1506123 | false
1800055 | 0001213900-24-095260 | operations | 4 | 0 | 1-K | 2024-04-30 | Loss from operations | 2023 | 2023 | -974784 | false
1800055 | 0001213900-24-095260 | operations | 4 | 1 | 1-K | 2024-04-30 | Loss from operations | 2022 | 2022 | -1433306 | false
1800055 | 0001213900-24-095260 | operations | 5 | 0 | 1-K | 2024-04-30 | Interest expense | 2023 | 2023 | -43146 | false
1800055 | 0001213900-24-095260 | operations | 5 | 1 | 1-K | 2024-04-30 | Interest expense | 2022 | 2022 | -28731 | false
1800055 | 0001213900-24-095260 | operations | 6 | 0 | 1-K | 2024-04-30 | Loss on investment | 2023 | 2023 | 0 | false
1800055 | 0001213900-24-095260 | operations | 6 | 1 | 1-K | 2024-04-30 | Loss on investment | 2022 | 2022 | -144000 | false
1800055 | 0001213900-24-095260 | operations | 7 | 0 | 1-K | 2024-04-30 | Total other income (expense), net | 2023 | 2023 | -43146 | false
1800055 | 0001213900-24-095260 | operations | 7 | 1 | 1-K | 2024-04-30 | Total other income (expense), net | 2022 | 2022 | -172731 | false
1800055 | 0001213900-24-095260 | operations | 8 | 0 | 1-K | 2024-04-30 | Provision for income taxes | 2023 | 2023 | 0 | false
1800055 | 0001213900-24-095260 | operations | 8 | 1 | 1-K | 2024-04-30 | Provision for income taxes | 2022 | 2022 | 0 | false
1800055 | 0001213900-24-095260 | operations | 9 | 0 | 1-K | 2024-04-30 | Net loss | 2023 | 2023 | -1017930 | false
1800055 | 0001213900-24-095260 | operations | 9 | 1 | 1-K | 2024-04-30 | Net loss | 2022 | 2022 | -1606037 | false
1800055 | 0001213900-24-095260 | operations | 10 | 0 | 1-K | 2024-04-30 | Net loss per common share - basic and diluted | 2023 | 2023 | -0.11 | false
1800055 | 0001213900-24-095260 | operations | 10 | 1 | 1-K | 2024-04-30 | Net loss per common share - basic and diluted | 2022 | 2022 | -0.18 | false
1800055 | 0001213900-24-095260 | operations | 11 | 0 | 1-K | 2024-04-30 | Weighted average common shares outstanding - basic and diluted | 2023 | 2023 | 9116757 | false
1800055 | 0001213900-24-095260 | operations | 11 | 1 | 1-K | 2024-04-30 | Weighted average common shares outstanding - basic and diluted | 2022 | 2022 | 8952499 | false
`;

/** Every stored figure of CIK 1838432 accession 0001104659-24-104481, in key order. */
const BASELINE_1SA = `
1838432 | 0001104659-24-104481 | balance_sheet | 0 | 0 | 1-SA | 2024-09-27 | Cash and cash equivalents | June 30, 2024 | June 30, 2024 | 1166757 | true
1838432 | 0001104659-24-104481 | balance_sheet | 0 | 1 | 1-SA | 2024-09-27 | Cash and cash equivalents | December 31, 2023 | December 31, 2023 | 2217114 | true
1838432 | 0001104659-24-104481 | balance_sheet | 1 | 0 | 1-SA | 2024-09-27 | Total current assets | June 30, 2024 | June 30, 2024 | 1166757 | true
1838432 | 0001104659-24-104481 | balance_sheet | 1 | 1 | 1-SA | 2024-09-27 | Total current assets | December 31, 2023 | December 31, 2023 | 2217114 | true
1838432 | 0001104659-24-104481 | balance_sheet | 2 | 0 | 1-SA | 2024-09-27 | Fixed assets, net of accumulated depreciation | June 30, 2024 | June 30, 2024 | 26185 | true
1838432 | 0001104659-24-104481 | balance_sheet | 2 | 1 | 1-SA | 2024-09-27 | Fixed assets, net of accumulated depreciation | December 31, 2023 | December 31, 2023 | 21642 | true
1838432 | 0001104659-24-104481 | balance_sheet | 3 | 0 | 1-SA | 2024-09-27 | Intangible assets | June 30, 2024 | June 30, 2024 | 1019262 | true
1838432 | 0001104659-24-104481 | balance_sheet | 3 | 1 | 1-SA | 2024-09-27 | Intangible assets | December 31, 2023 | December 31, 2023 | 550387 | true
1838432 | 0001104659-24-104481 | balance_sheet | 4 | 0 | 1-SA | 2024-09-27 | Total Assets | June 30, 2024 | June 30, 2024 | 2212204 | true
1838432 | 0001104659-24-104481 | balance_sheet | 4 | 1 | 1-SA | 2024-09-27 | Total Assets | December 31, 2023 | December 31, 2023 | 2789143 | true
1838432 | 0001104659-24-104481 | balance_sheet | 5 | 0 | 1-SA | 2024-09-27 | Accounts payable | June 30, 2024 | June 30, 2024 | 20198 | true
1838432 | 0001104659-24-104481 | balance_sheet | 5 | 1 | 1-SA | 2024-09-27 | Accounts payable | December 31, 2023 | December 31, 2023 | 20198 | true
1838432 | 0001104659-24-104481 | balance_sheet | 6 | 0 | 1-SA | 2024-09-27 | Other current liabilities | June 30, 2024 | June 30, 2024 | 74339 | true
1838432 | 0001104659-24-104481 | balance_sheet | 6 | 1 | 1-SA | 2024-09-27 | Other current liabilities | December 31, 2023 | December 31, 2023 | 31525 | true
1838432 | 0001104659-24-104481 | balance_sheet | 7 | 0 | 1-SA | 2024-09-27 | Total Current Liabilities | June 30, 2024 | June 30, 2024 | 94537 | true
1838432 | 0001104659-24-104481 | balance_sheet | 7 | 1 | 1-SA | 2024-09-27 | Total Current Liabilities | December 31, 2023 | December 31, 2023 | 51723 | true
1838432 | 0001104659-24-104481 | balance_sheet | 8 | 0 | 1-SA | 2024-09-27 | Notes payable | June 30, 2024 | June 30, 2024 | 473190 | true
1838432 | 0001104659-24-104481 | balance_sheet | 8 | 1 | 1-SA | 2024-09-27 | Notes payable | December 31, 2023 | December 31, 2023 | 483190 | true
1838432 | 0001104659-24-104481 | balance_sheet | 9 | 0 | 1-SA | 2024-09-27 | Convertible note payable, net of issuance costs and commitments receivable | June 30, 2024 | June 30, 2024 | 3359437 | true
1838432 | 0001104659-24-104481 | balance_sheet | 9 | 1 | 1-SA | 2024-09-27 | Convertible note payable, net of issuance costs and commitments receivable | December 31, 2023 | December 31, 2023 | 1678500 | true
1838432 | 0001104659-24-104481 | balance_sheet | 10 | 0 | 1-SA | 2024-09-27 | Accrued interest payable | June 30, 2024 | June 30, 2024 | 0 | true
1838432 | 0001104659-24-104481 | balance_sheet | 10 | 1 | 1-SA | 2024-09-27 | Accrued interest payable | December 31, 2023 | December 31, 2023 | 74370 | true
1838432 | 0001104659-24-104481 | balance_sheet | 11 | 0 | 1-SA | 2024-09-27 | Government-backed loans payable | June 30, 2024 | June 30, 2024 | 35555 | true
1838432 | 0001104659-24-104481 | balance_sheet | 11 | 1 | 1-SA | 2024-09-27 | Government-backed loans payable | December 31, 2023 | December 31, 2023 | 36300 | true
1838432 | 0001104659-24-104481 | balance_sheet | 12 | 0 | 1-SA | 2024-09-27 | Total Liabilities | June 30, 2024 | June 30, 2024 | 3962719 | true
1838432 | 0001104659-24-104481 | balance_sheet | 12 | 1 | 1-SA | 2024-09-27 | Total Liabilities | December 31, 2023 | December 31, 2023 | 2324083 | true
1838432 | 0001104659-24-104481 | balance_sheet | 13 | 0 | 1-SA | 2024-09-27 | Common Stock | June 30, 2024 | June 30, 2024 | 8587470 | true
1838432 | 0001104659-24-104481 | balance_sheet | 13 | 1 | 1-SA | 2024-09-27 | Common Stock | December 31, 2023 | December 31, 2023 | 8587470 | true
1838432 | 0001104659-24-104481 | balance_sheet | 14 | 0 | 1-SA | 2024-09-27 | Retained deficit | June 30, 2024 | June 30, 2024 | -10337985 | true
1838432 | 0001104659-24-104481 | balance_sheet | 14 | 1 | 1-SA | 2024-09-27 | Retained deficit | December 31, 2023 | December 31, 2023 | -8122409 | true
1838432 | 0001104659-24-104481 | balance_sheet | 15 | 0 | 1-SA | 2024-09-27 | Total Shareholders' Equity | June 30, 2024 | June 30, 2024 | -1750515 | true
1838432 | 0001104659-24-104481 | balance_sheet | 15 | 1 | 1-SA | 2024-09-27 | Total Shareholders' Equity | December 31, 2023 | December 31, 2023 | 465061 | true
1838432 | 0001104659-24-104481 | balance_sheet | 16 | 0 | 1-SA | 2024-09-27 | Total Liabilities and Shareholders' Equity | June 30, 2024 | June 30, 2024 | 2212204 | true
1838432 | 0001104659-24-104481 | balance_sheet | 16 | 1 | 1-SA | 2024-09-27 | Total Liabilities and Shareholders' Equity | December 31, 2023 | December 31, 2023 | 2789143 | true
1838432 | 0001104659-24-104481 | cash_flows | 0 | 0 | 1-SA | 2024-09-27 | Net Income (Loss) | 2024 | 2024 | -2177061 | true
1838432 | 0001104659-24-104481 | cash_flows | 0 | 1 | 1-SA | 2024-09-27 | Net Income (Loss) | 2023 | 2023 | -619201 | true
1838432 | 0001104659-24-104481 | cash_flows | 1 | 0 | 1-SA | 2024-09-27 | Add depreciation | 2024 | 2024 | 0 | true
1838432 | 0001104659-24-104481 | cash_flows | 1 | 1 | 1-SA | 2024-09-27 | Add depreciation | 2023 | 2023 | 0 | true
1838432 | 0001104659-24-104481 | cash_flows | 2 | 0 | 1-SA | 2024-09-27 | Increase (decrease) in accounts payable | 2024 | 2024 | 0 | true
1838432 | 0001104659-24-104481 | cash_flows | 2 | 1 | 1-SA | 2024-09-27 | Increase (decrease) in accounts payable | 2023 | 2023 | 0 | true
1838432 | 0001104659-24-104481 | cash_flows | 3 | 0 | 1-SA | 2024-09-27 | Increase (decrease) in other current liabilities | 2024 | 2024 | 41153 | true
1838432 | 0001104659-24-104481 | cash_flows | 3 | 1 | 1-SA | 2024-09-27 | Increase (decrease) in other current liabilities | 2023 | 2023 | 0 | true
1838432 | 0001104659-24-104481 | cash_flows | 4 | 0 | 1-SA | 2024-09-27 | Increase (decrease) in loan payable | 2024 | 2024 | 0 | true
1838432 | 0001104659-24-104481 | cash_flows | 4 | 1 | 1-SA | 2024-09-27 | Increase (decrease) in loan payable | 2023 | 2023 | -17000 | true
1838432 | 0001104659-24-104481 | cash_flows | 5 | 0 | 1-SA | 2024-09-27 | Net cash used in operating activities | 2024 | 2024 | -2135908 | true
1838432 | 0001104659-24-104481 | cash_flows | 5 | 1 | 1-SA | 2024-09-27 | Net cash used in operating activities | 2023 | 2023 | -636201 | true
1838432 | 0001104659-24-104481 | cash_flows | 6 | 0 | 1-SA | 2024-09-27 | Acquisition of fixed assets | 2024 | 2024 | -2881 | true
1838432 | 0001104659-24-104481 | cash_flows | 6 | 1 | 1-SA | 2024-09-27 | Acquisition of fixed assets | 2023 | 2023 | 0 | true
1838432 | 0001104659-24-104481 | cash_flows | 7 | 0 | 1-SA | 2024-09-27 | Acquisition of intangible assets | 2024 | 2024 | -468875 | true
1838432 | 0001104659-24-104481 | cash_flows | 7 | 1 | 1-SA | 2024-09-27 | Acquisition of intangible assets | 2023 | 2023 | -38500 | true
1838432 | 0001104659-24-104481 | cash_flows | 8 | 0 | 1-SA | 2024-09-27 | Net cash used in operating activities | 2024 | 2024 | -471756 | true
1838432 | 0001104659-24-104481 | cash_flows | 8 | 1 | 1-SA | 2024-09-27 | Net cash used in operating activities | 2023 | 2023 | -38500 | true
1838432 | 0001104659-24-104481 | cash_flows | 9 | 0 | 1-SA | 2024-09-27 | Proceeds from capital transactions | 2024 | 2024 | 1498219 | true
1838432 | 0001104659-24-104481 | cash_flows | 9 | 1 | 1-SA | 2024-09-27 | Proceeds from capital transactions | 2023 | 2023 | 3375124 | true
1838432 | 0001104659-24-104481 | cash_flows | 10 | 0 | 1-SA | 2024-09-27 | Proceeds from (repayments of) of notes payable | 2024 | 2024 | -39260 | true
1838432 | 0001104659-24-104481 | cash_flows | 10 | 1 | 1-SA | 2024-09-27 | Proceeds from (repayments of) of notes payable | 2023 | 2023 | 0 | true
1838432 | 0001104659-24-104481 | cash_flows | 11 | 0 | 1-SA | 2024-09-27 | Proceeds from (conversion of) convertible notes | 2024 | 2024 | 98348 | true
1838432 | 0001104659-24-104481 | cash_flows | 11 | 1 | 1-SA | 2024-09-27 | Proceeds from (conversion of) convertible notes | 2023 | 2023 | -1885349 | true
1838432 | 0001104659-24-104481 | cash_flows | 12 | 0 | 1-SA | 2024-09-27 | Net change in cash from financing activities | 2024 | 2024 | 1557307 | true
1838432 | 0001104659-24-104481 | cash_flows | 12 | 1 | 1-SA | 2024-09-27 | Net change in cash from financing activities | 2023 | 2023 | 1489776 | true
1838432 | 0001104659-24-104481 | cash_flows | 13 | 0 | 1-SA | 2024-09-27 | Net change in cash and cash equivalents | 2024 | 2024 | -1050357 | true
1838432 | 0001104659-24-104481 | cash_flows | 13 | 1 | 1-SA | 2024-09-27 | Net change in cash and cash equivalents | 2023 | 2023 | 815075 | true
1838432 | 0001104659-24-104481 | cash_flows | 14 | 0 | 1-SA | 2024-09-27 | Cash and cash equivalents at beginning of period | 2024 | 2024 | 2217114 | true
1838432 | 0001104659-24-104481 | cash_flows | 14 | 1 | 1-SA | 2024-09-27 | Cash and cash equivalents at beginning of period | 2023 | 2023 | 170216 | true
1838432 | 0001104659-24-104481 | cash_flows | 15 | 0 | 1-SA | 2024-09-27 | Cash and cash equivalents at end of period | 2024 | 2024 | 1166757 | true
1838432 | 0001104659-24-104481 | cash_flows | 15 | 1 | 1-SA | 2024-09-27 | Cash and cash equivalents at end of period | 2023 | 2023 | 985291 | true
1838432 | 0001104659-24-104481 | operations | 0 | 0 | 1-SA | 2024-09-27 | Revenues, net | 2024 | 2024 | 841974 | true
1838432 | 0001104659-24-104481 | operations | 0 | 1 | 1-SA | 2024-09-27 | Revenues, net | 2023 | 2023 | 104721 | true
1838432 | 0001104659-24-104481 | operations | 1 | 0 | 1-SA | 2024-09-27 | Marketing and advertising | 2024 | 2024 | 394125 | true
1838432 | 0001104659-24-104481 | operations | 1 | 1 | 1-SA | 2024-09-27 | Marketing and advertising | 2023 | 2023 | 61752 | true
1838432 | 0001104659-24-104481 | operations | 2 | 0 | 1-SA | 2024-09-27 | Selling, general and administrative | 2024 | 2024 | 2624008 | true
1838432 | 0001104659-24-104481 | operations | 2 | 1 | 1-SA | 2024-09-27 | Selling, general and administrative | 2023 | 2023 | 660807 | true
1838432 | 0001104659-24-104481 | operations | 3 | 0 | 1-SA | 2024-09-27 | Total operating expenses | 2024 | 2024 | 3018133 | true
1838432 | 0001104659-24-104481 | operations | 3 | 1 | 1-SA | 2024-09-27 | Total operating expenses | 2023 | 2023 | 722559 | true
1838432 | 0001104659-24-104481 | operations | 4 | 0 | 1-SA | 2024-09-27 | Net Operating Income (Loss) | 2024 | 2024 | -2176159 | true
1838432 | 0001104659-24-104481 | operations | 4 | 1 | 1-SA | 2024-09-27 | Net Operating Income (Loss) | 2023 | 2023 | -617838 | true
1838432 | 0001104659-24-104481 | operations | 5 | 0 | 1-SA | 2024-09-27 | Interest (expense) | 2024 | 2024 | -902 | true
1838432 | 0001104659-24-104481 | operations | 5 | 1 | 1-SA | 2024-09-27 | Interest (expense) | 2023 | 2023 | -1363 | true
1838432 | 0001104659-24-104481 | operations | 6 | 0 | 1-SA | 2024-09-27 | Tax provision (benefit) | 2024 | 2024 | 0 | true
1838432 | 0001104659-24-104481 | operations | 6 | 1 | 1-SA | 2024-09-27 | Tax provision (benefit) | 2023 | 2023 | 0 | true
1838432 | 0001104659-24-104481 | operations | 7 | 0 | 1-SA | 2024-09-27 | Net Income (Loss) | 2024 | 2024 | -2177061 | true
1838432 | 0001104659-24-104481 | operations | 7 | 1 | 1-SA | 2024-09-27 | Net Income (Loss) | 2023 | 2023 | -619201 | true
`;

describe("rega_financial_line baseline", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("records every row the CalTier 1-K PART II report stores", async () => {
    const parsed = await Form_1_K.parse("1-K", SUBMISSION_1K);
    await storeRegAFinancialStatements({
      cik: 1800055,
      accession_number: "0001213900-24-095260",
      form: "1-K",
      filing_date: "2024-04-30",
      statements: parsed.statements,
    });

    const rows = await new RegAFinancialLineRepo().queryByAccession("0001213900-24-095260");
    expect(rows.length).toBe(112);
    expect(recorded(rows)).toEqual(expected(BASELINE_1K));
  });

  it("records every row the 1-SA semiannual report stores", async () => {
    const parsed = await Form_1_SA.parse("1-SA", REPORT_1SA);
    await storeRegAFinancialStatements({
      cik: 1838432,
      accession_number: "0001104659-24-104481",
      form: "1-SA",
      filing_date: "2024-09-27",
      statements: parsed.statements,
    });

    const rows = await new RegAFinancialLineRepo().queryByAccession("0001104659-24-104481");
    expect(rows.length).toBe(82);
    expect(recorded(rows)).toEqual(expected(BASELINE_1SA));
  });

  it("keeps the separator unambiguous — no recorded field contains one", async () => {
    // The recording is only faithful if a line splits back into exactly the
    // twelve columns it was built from. A label carrying the separator would
    // fold two columns into one and hide a difference rather than show it.
    const k = await Form_1_K.parse("1-K", SUBMISSION_1K);
    await storeRegAFinancialStatements({
      cik: 1800055,
      accession_number: "0001213900-24-095260",
      form: "1-K",
      filing_date: "2024-04-30",
      statements: k.statements,
    });
    const sa = await Form_1_SA.parse("1-SA", REPORT_1SA);
    await storeRegAFinancialStatements({
      cik: 1838432,
      accession_number: "0001104659-24-104481",
      form: "1-SA",
      filing_date: "2024-09-27",
      statements: sa.statements,
    });

    const repo = new RegAFinancialLineRepo();
    const all = [
      ...(await repo.queryByAccession("0001213900-24-095260")),
      ...(await repo.queryByAccession("0001104659-24-104481")),
    ];
    expect(all.length).toBe(194);
    for (const row of recorded(all)) {
      expect(row.split(FIELD_SEPARATOR).length).toBe(12);
    }
  });
});
