/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseRegAFinancialStatements,
  readRowValues,
  type RegAStatement,
} from "./regAFinancialStatements";

const table = (rows: string[][]): string =>
  `<html><body><table>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("")}</table></body></html>`;

const find = (statements: RegAStatement[], kind: string): RegAStatement => {
  const found = statements.find((s) => s.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} statement; got ${statements.map((s) => s.kind)}`);
  return found;
};

const row = (statement: RegAStatement, label: string): (number | null)[] => {
  const found = statement.rows.find((r) => r.label.toLowerCase().startsWith(label.toLowerCase()));
  if (found === undefined) throw new Error(`no row "${label}"; got ${statement.rows.map((r) => r.label)}`);
  return found.values;
};

describe("readRowValues", () => {
  it("keeps a negative that EDGAR split across cell boundaries", () => {
    // The single most consequential case. EDGAR emits an accounting negative as
    // `['(1,349,427', ')']`, and a per-cell parse reads that as a POSITIVE —
    // silently flipping the sign of every loss in the corpus.
    expect(readRowValues(["$", "(1,349,427", ")"])).toEqual([-1349427]);
    expect(readRowValues(["(", "1,234", ")"])).toEqual([-1234]);
  });

  it("keeps a negative behind a currency symbol", () => {
    // `parseNumeric("$ (1,234)")` returns a positive 1,234 — the space defeats
    // its negative detection — so the whitespace strip before parsing is
    // load-bearing, not tidiness.
    expect(readRowValues(["$ (1,234)"])).toEqual([-1234]);
  });

  it("reads a dash as the zero it stands for, holding column alignment", () => {
    // A dropped dash does not just lose that cell, it shifts every later column
    // LEFT: `-  5,000` would report 5,000 under the first period rather than the
    // second. Recovered 178 further rows across the 60-filing sample.
    expect(readRowValues(["-", "5,000"])).toEqual([0, 5000]);
    expect(readRowValues(["$", "-", "", "$", "5,000"])).toEqual([0, 5000]);
    expect(readRowValues(["—", "5,000"])).toEqual([0, 5000]);
    expect(readRowValues(["1,234", "-"])).toEqual([1234, 0]);
  });

  it("does not mistake a signed number's minus for a placeholder", () => {
    expect(readRowValues(["-1,234"])).toEqual([-1234]);
    expect(readRowValues(["0.11"])).toEqual([0.11]);
  });

  it("reads no values from empty cells", () => {
    expect(readRowValues([])).toEqual([]);
    expect(readRowValues(["", "", ""])).toEqual([]);
  });
});

describe("parseRegAFinancialStatements — column headings", () => {
  it("reads full dates from a header row that also carries a section label", () => {
    const html = table([
      ["ASSETS", "", "April 30, 2026", "", "October 31, 2025"],
      ["Cash", "", "195,401", "", "77,507"],
      ["Total Assets", "", "1,418,319", "", "1,312,011"],
      ["Total Liabilities", "", "627,224", "", "618,894"],
    ]);
    const bs = find(parseRegAFinancialStatements(html), "balance_sheet");
    // "April 30, 2026" contains digits, so a naive data-row test reads the
    // header as data and ends the header block before it starts.
    expect(bs.periods).toEqual(["April 30, 2026", "October 31, 2025"]);
    expect(row(bs, "Total Assets")).toEqual([1418319, 1312011]);
  });

  it("reads bare years, which is how an operations statement heads its columns", () => {
    // The period language ("For the Six Months Ended April 30,") sits in a
    // caption OUTSIDE the table, where a table-scoped parse cannot see it.
    const html = table([
      ["", "", "2026", "", "2025"],
      ["Revenues, net", "", "187,026", "", "231,818"],
      ["Net Income (Loss)", "", "(1,349,427", ")", "(1,265,764", ")"],
    ]);
    const ops = find(parseRegAFinancialStatements(html), "operations");
    expect(ops.periods).toEqual(["2026", "2025"]);
    expect(row(ops, "Net Income")).toEqual([-1349427, -1265764]);
  });

  it("reaches the dates on the second line of a two-row header", () => {
    // Stopping at the first header-shaped row yielded `["As of", "As of"]` and
    // threw the dates away.
    const html = table([
      ["", "", "As of", "", "As of"],
      ["", "", "June 30, 2024", "", "December 31, 2023"],
      ["Total Assets", "", "2,212,204", "", "2,789,143"],
      ["Total Liabilities", "", "3,962,719", "", "2,324,083"],
    ]);
    const bs = find(parseRegAFinancialStatements(html), "balance_sheet");
    expect(bs.periods).toEqual(["June 30, 2024", "December 31, 2023"]);
  });

  it("reassembles a date split across cells", () => {
    // GolfSuites heads its columns `['June', '30,', '2023', ...]` — per cell
    // that is no date at all, so the cells are joined before matching.
    const html = table([
      ["", "June", "30,", "2023", "", "December", "31,", "2022"],
      ["Total Assets", "", "100", "", "", "", "200"],
      ["Total Liabilities", "", "40", "", "", "", "60"],
    ]);
    const bs = find(parseRegAFinancialStatements(html), "balance_sheet");
    expect(bs.periods).toEqual(["June 30, 2023", "December 31, 2022"]);
  });

  it("keeps segment headings as columns while reporting no periods", () => {
    // A multi-series issuer heads its columns by SEGMENT. Those labels are all
    // that separates the columns, so dropping them leaves the values
    // unattributable — but they are not dates and must not be reported as such.
    const html = table([
      ["", "", "ROCF II Series", "", "ROIOF Series", "", "Consolidated"],
      ["Total Assets", "", "1,263,517", "", "3,950,377", "", "5,213,894"],
      ["Total Liabilities", "", "1,000", "", "2,000", "", "3,000"],
    ]);
    const bs = find(parseRegAFinancialStatements(html), "balance_sheet");
    expect(bs.periods).toEqual([]);
    expect(bs.columns).toEqual(["ROCF II Series", "ROIOF Series", "Consolidated"]);
    expect(row(bs, "Total Assets")).toEqual([1263517, 3950377, 5213894]);
  });

  it("does not read a section heading as a column header", () => {
    // `['ASSETS', '', '']` labels the rows beneath it; a column header starts
    // with an empty label cell. Reporting no columns is the honest answer for a
    // statement that states its date in a caption.
    const html = table([
      ["ASSETS", "", ""],
      ["CURRENT ASSETS", "", ""],
      ["Cash and Cash Equivalents", "$", "444,543"],
      ["TOTAL ASSETS", "", "444,543"],
      ["Total Liabilities", "", "0"],
    ]);
    const bs = find(parseRegAFinancialStatements(html), "balance_sheet");
    expect(bs.columns).toEqual([]);
    expect(row(bs, "Cash and Cash")).toEqual([444543]);
  });
});

describe("parseRegAFinancialStatements — rows", () => {
  it("never reads a value out of the label, however many digits it holds", () => {
    // "Common Stock (125,000,000 and 35,146,765 shares)" would otherwise report
    // the authorised share count as the first period's figure.
    const html = table([
      ["", "", "April 30, 2026", "", "October 31, 2025"],
      ["Total Assets", "", "1,000", "", "2,000"],
      ["Total Liabilities", "", "10", "", "20"],
      ["Common Stock (125,000,000 and 35,146,765 shares issued)", "", "3,514", "", "1,250"],
    ]);
    const bs = find(parseRegAFinancialStatements(html), "balance_sheet");
    expect(row(bs, "Common Stock")).toEqual([3514, 1250]);
  });

  it("pads a row reporting fewer columns than the header declares", () => {
    const html = table([
      ["", "", "2026", "", "2025"],
      ["Revenue", "", "500", "", "400"],
      ["Net Income", "", "100", "", "80"],
      ["Line item introduced this period", "", "25"],
    ]);
    const ops = find(parseRegAFinancialStatements(html), "operations");
    expect(row(ops, "Line item introduced")).toEqual([25, null]);
  });

  it("records the label verbatim, even where the filer mislabelled it", () => {
    // A real 1-SA labels its INVESTING subtotal "Net cash used in operating
    // activities". The filing is the body of record; the parser does not correct
    // it.
    const html = table([
      ["", "", "2024", "", "2023"],
      ["Operating Activities", "", "", "", ""],
      ["Net cash used in operating activities", "", "(2,135,908", ")", "(636,201", ")"],
      ["Investing Activities", "", "", "", ""],
      ["Net cash used in operating activities", "", "(471,756", ")", "(38,500", ")"],
      ["Financing Activities", "", "", "", ""],
      ["Net cash provided by financing activities", "", "1,000", "", "2,000"],
    ]);
    const cf = find(parseRegAFinancialStatements(html), "cash_flows");
    const both = cf.rows.filter((r) => r.label === "Net cash used in operating activities");
    expect(both).toHaveLength(2);
    expect(both[0].values).toEqual([-2135908, -636201]);
    expect(both[1].values).toEqual([-471756, -38500]);
  });
});

describe("parseRegAFinancialStatements — statement identification", () => {
  it("calls a cash-flow statement cash flows, not operations", () => {
    // A cash-flow statement also carries "net income", so the more specific
    // anchor pair has to be tried first.
    const html = table([
      ["", "", "2026", "", "2025"],
      ["Cash flows from operating activities", "", "", "", ""],
      ["Net Income (Loss)", "", "(1,349,427", ")", "(1,265,764", ")"],
      ["Cash flows from financing activities", "", "", "", ""],
      ["Net change in cash", "", "117,894", "", "245,114"],
    ]);
    const statements = parseRegAFinancialStatements(html);
    expect(statements.map((s) => s.kind)).toEqual(["cash_flows"]);
  });

  it("prefers the real statement over its table-of-contents entry", () => {
    // A filing lists its statements in a contents table carrying no figures at
    // all, so the candidate with the most DATA rows wins rather than the first.
    const contents = [
      ["Total Assets and Total Liabilities — see page F-2", "", ""],
      ["Balance Sheet", "", "F-2"],
    ];
    const real = [
      ["", "", "April 30, 2026"],
      ["Total Assets", "", "1,418,319"],
      ["Total Liabilities", "", "627,224"],
      ["Cash", "", "195,401"],
    ];
    const html = `<html><body><table>${contents
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</table><table>${real
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</table></body></html>`;
    const bs = find(parseRegAFinancialStatements(html), "balance_sheet");
    expect(bs.periods).toEqual(["April 30, 2026"]);
    expect(row(bs, "Total Assets")).toEqual([1418319]);
  });

  it("returns nothing for a document carrying no statements", () => {
    expect(parseRegAFinancialStatements("<html><body><p>Nothing here.</p></body></html>")).toEqual([]);
  });

  it("takes audit status from the report, not from one table", () => {
    // A 1-SA declares itself unaudited once, often on the balance sheet only.
    // Every statement in the filing is equally unaudited.
    const html = `<html><body><p>(Unaudited)</p><table>${[
      ["", "", "2026", "", "2025"],
      ["Cash flows from operating activities", "", "", "", ""],
      ["Net Income", "", "100", "", "80"],
      ["Cash flows from financing activities", "", "", "", ""],
    ]
      .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
      .join("")}</table></body></html>`;
    expect(find(parseRegAFinancialStatements(html), "cash_flows").unaudited).toBe(true);
  });
});

describe("parseRegAFinancialStatements — real filings", () => {
  const fixture = (name: string): string =>
    readFileSync(join(__dirname, "mock_data", "rega-financials", name), "utf-8");

  it("extracts the CalTier 1-K PART II annual report", () => {
    // CIK 1800055, accession 0001213900-24-095260, document ea0219991-1k_caltier.htm.
    // The 1-K's own primary_doc.xml carries no financial elements at all — this
    // is the separate PART II document, which nothing was reading.
    const statements = parseRegAFinancialStatements(
      fixture("1k-partii-1800055-000121390024095260.htm")
    );
    expect(statements.map((s) => s.kind)).toEqual(["balance_sheet", "operations", "cash_flows"]);

    const bs = find(statements, "balance_sheet");
    expect(bs.periods).toEqual(["2023", "2022"]);
    expect(row(bs, "Total assets")).toEqual([1491657, 1038273]);
    expect(row(bs, "Total liabilities")).toEqual([1610397, 1024225]);
    // The accounting identity: assets equal liabilities plus equity. It holds
    // only if the values AND their column mapping are both right, which makes it
    // the strongest available check that nothing shifted.
    expect(row(bs, "Total liabilities and stockholders")).toEqual([1491657, 1038273]);

    const ops = find(statements, "operations");
    expect(row(ops, "Net loss")).toEqual([-1017930, -1606037]);
    expect(row(ops, "Net loss per common share")).toEqual([-0.11, -0.18]);

    const cf = find(statements, "cash_flows");
    // Net loss agrees across the two statements — a second cross-check.
    expect(row(cf, "Net loss")).toEqual([-1017930, -1606037]);
    expect(row(cf, "Net cash used in operating activities")).toEqual([-324430, -1051618]);
    expect(row(cf, "Net cash provided by financing activities")).toEqual([207072, 928244]);
  });

  it("extracts a 1-SA semiannual report, with its two-row date header", () => {
    // CIK 1838432, accession 0001104659-24-104481, document tm2425224d1_1sa.htm.
    const statements = parseRegAFinancialStatements(fixture("1sa-1838432-000110465924104481.htm"));
    expect(statements.map((s) => s.kind)).toEqual(["balance_sheet", "operations", "cash_flows"]);

    const bs = find(statements, "balance_sheet");
    expect(bs.periods).toEqual(["June 30, 2024", "December 31, 2023"]);
    expect(row(bs, "Total Assets")).toEqual([2212204, 2789143]);
    expect(row(bs, "Total Liabilities and Shareholders")).toEqual([2212204, 2789143]);

    // Every statement in a 1-SA is unaudited, including the ones whose own table
    // does not say so.
    expect(statements.every((s) => s.unaudited)).toBe(true);

    const ops = find(statements, "operations");
    expect(row(ops, "Net Income (Loss)")).toEqual([-2177061, -619201]);
    expect(row(find(statements, "cash_flows"), "Net Income (Loss)")).toEqual([-2177061, -619201]);
  });
});
