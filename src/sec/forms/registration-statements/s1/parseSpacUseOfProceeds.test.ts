/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  parseSpacUseOfProceeds,
  resetUseOfProceedsParseCacheForTesting,
  useOfProceedsIsComplete,
} from "./parseSpacUseOfProceeds";

function purposes(text: string): string[] {
  return parseSpacUseOfProceeds(text).map((r) => r.purpose ?? "");
}

const CHURCHILL = [
  "|  | Without Over-Allotment Option | Without Over-Allotment Option | With Over-Allotment Option | With Over-Allotment Option |",
  "| --- | --- | --- | --- | --- |",
  "| Gross proceeds from units offered to public(1) | $ | 300,000,000 | $ | 345,000,000 |",
  "| Offering expenses(2) |  |  |  |  |",
  "| Underwriting discounts and commissions (excluding deferred portion)(3) | $ | 4,500,000 | $ | 5,175,000 |",
  "| Legal fees and expenses |  | 325,000 |  | 325,000 |",
  "| Miscellaneous |  | 385,641 |  | 385,641 |",
  "| Total offering expenses (excluding underwriting discounts and commissions) | $ | 1,000,000 | $ | 1,000,000 |",
  "| Reimbursed expenses(4) |  | 3,000,000 |  | 3,675,000 |",
  "| Proceeds after offering expenses | $ | 301,000,000 | $ | 346,000,000 |",
  "| Held in trust account(1)(3) | $ | 300,000,000 | $ | 345,000,000 |",
  "| % public offering size |  | 100.0 | % | 100.0 |",
  "| Not held in trust account | $ | 1,000,000 | $ | 1,000,000 |",
  "| Legal, accounting, due diligence, travel and other expenses in connection with business combination | $ | 100,000 | 10.0 | % |",
  "| Working capital to cover miscellaneous expenses |  | 40,000 | 4.0 | % |",
  "| Total | $ | 1,000,000 | 100.0 | % |",
].join("\n");

describe("parseSpacUseOfProceeds", () => {
  it("never throws", () => {
    expect(parseSpacUseOfProceeds("")).toEqual([]);
    expect(parseSpacUseOfProceeds("|  |")).toEqual([]);
  });

  it("reads offering-expense and working-capital lines and skips totals and sources", () => {
    const rows = parseSpacUseOfProceeds(CHURCHILL);
    expect(purposes(CHURCHILL)).toEqual([
      "Underwriting discounts and commissions (excluding deferred portion)",
      "Legal fees and expenses",
      "Miscellaneous",
      "Reimbursed expenses",
      "Held in trust account",
      "Not held in trust account",
      "Legal, accounting, due diligence, travel and other expenses in connection with business combination",
      "Working capital to cover miscellaneous expenses",
    ]);
    expect(rows.find((r) => r.purpose === "Legal fees and expenses")?.amount).toBe(325_000);
    expect(rows.find((r) => r.purpose === "Held in trust account")?.amount).toBe(300_000_000);
    expect(rows.every((r) => r.source === "deterministic")).toBe(true);
  });

  it("uses the without-over-allotment amount, not the over-allotment column", () => {
    const rows = parseSpacUseOfProceeds(CHURCHILL);
    expect(rows.find((r) => r.purpose?.startsWith("Underwriting discounts"))?.amount).toBe(
      4_500_000
    );
  });

  it("returns empty when fewer than two amount lines exist", () => {
    const text = ["| Legal fees and expenses | $ | 325,000 |", "| --- | --- | --- |"].join("\n");
    expect(parseSpacUseOfProceeds(text)).toEqual([]);
  });

  it("skips source-of-funds rows", () => {
    const text = [
      "| From sale of units via private placement | $ | 7,000,000 |",
      "| Underwriting discounts and commissions | $ | 4,500,000 |",
      "| Held in trust account | $ | 300,000,000 |",
    ].join("\n");
    expect(purposes(text)).toEqual([
      "Underwriting discounts and commissions",
      "Held in trust account",
    ]);
  });

  // The way most filers write the largest expense row in the table. A skip rule
  // matching "gross proceeds" anywhere in the label deletes it — silently, and
  // on every replay, because this parse replaces the model call for the section.
  it("keeps an underwriting row whose parenthetical cites gross proceeds", () => {
    const text = [
      "| Gross proceeds from units offered to public | $ | 100,000,000 |",
      "| Underwriting commissions (2.0% of gross proceeds from units offered to public, excluding deferred portion) | $ | 2,000,000 |",
      "| Held in trust account | $ | 100,000,000 |",
    ].join("\n");
    expect(purposes(text)).toEqual([
      "Underwriting commissions (2.0% of gross proceeds from units offered to public, excluding deferred portion)",
      "Held in trust account",
    ]);
  });

  it("keeps the residual trust row that names offering expenses", () => {
    const text = [
      "| Offering expenses |  |  |",
      "| Underwriting discounts and commissions | $ | 4,500,000 |",
      "| Not held in trust account after offering expenses | $ | 525,000 |",
    ].join("\n");
    expect(purposes(text)).toContain("Not held in trust account after offering expenses");
  });

  it("keeps a line item whose parenthetical states a per-unit rate", () => {
    const text = [
      "| Underwriting discounts and commissions | $ | 4,500,000 |",
      "| Held in trust account ($10.20 per unit) | $ | 306,000,000 |",
      "| Amount held in trust per share | $ | 10.20 |",
    ].join("\n");
    expect(purposes(text)).toEqual([
      "Underwriting discounts and commissions",
      "Held in trust account ($10.20 per unit)",
    ]);
  });

  // Some filers factor the sources into a block under a bare heading, so the
  // rows beneath it read as ordinary labels ("Offering", "Private Units") and
  // only the heading says they are where the money came from.
  it("skips the children of a bare gross-proceeds heading but not of an expenses heading", () => {
    const text = [
      "| Gross proceeds |  |  |",
      "| Offering(1) | $ | 200,000,000 |",
      "| Private Units(2) |  | 6,500,000 |",
      "| Total gross proceeds | $ | 206,500,000 |",
      "| Offering expenses(3) |  |  |",
      "| Underwriting discount | $ | 4,000,000 |",
      "| Held in the trust account from this offering | $ | 200,000,000 |",
    ].join("\n");
    expect(purposes(text)).toEqual([
      "Underwriting discount",
      "Held in the trust account from this offering",
    ]);
  });
});

describe("useOfProceedsIsComplete", () => {
  it("is true when every labelled row of the table was represented", () => {
    expect(useOfProceedsIsComplete(CHURCHILL)).toBe(true);
  });

  it("is false when a line item inside the table carries no readable figure", () => {
    const text = [
      "| Underwriting discounts and commissions | $ | 4,500,000 |",
      "| Miscellaneous |  | 385,641 |",
      "| Held in trust account(3) |  |  |",
      "| Not held in trust account | $ | 750,000 |",
    ].join("\n");
    expect(parseSpacUseOfProceeds(text).length).toBe(3);
    expect(useOfProceedsIsComplete(text)).toBe(false);
  });

  it("is false when the parse read nothing", () => {
    expect(useOfProceedsIsComplete("")).toBe(false);
  });
});

describe("the extract and complete readers share one walk", () => {
  // The runner calls both for the same section on the same pass. The
  // completeness verdict counts the rows the walk could NOT represent, which
  // never reach the returned array — so `complete` re-read the section, both
  // doubling the work and leaving two answers that could disagree.
  const TABLE = [
    "| Use of Proceeds | Amount |",
    "| --- | --- |",
    "| Held in trust account | $100,000,000 |",
    "| Underwriting discounts | $2,000,000 |",
  ].join("\n");

  it("answers identically whichever reader asks first", () => {
    resetUseOfProceedsParseCacheForTesting();
    const completeFirst = useOfProceedsIsComplete(TABLE);
    const rowsAfter = parseSpacUseOfProceeds(TABLE);
    resetUseOfProceedsParseCacheForTesting();
    const rowsFirst = parseSpacUseOfProceeds(TABLE);
    const completeAfter = useOfProceedsIsComplete(TABLE);
    expect(completeFirst).toBe(completeAfter);
    expect(rowsFirst).toEqual(rowsAfter);
  });

  it("is not a stale cache — a different section gets its own answer", () => {
    resetUseOfProceedsParseCacheForTesting();
    expect(parseSpacUseOfProceeds(TABLE).length).toBeGreaterThan(0);
    expect(parseSpacUseOfProceeds("no table here at all")).toEqual([]);
    expect(useOfProceedsIsComplete("no table here at all")).toBe(false);
    // ...and asking for the first one again still reads it.
    expect(parseSpacUseOfProceeds(TABLE).length).toBeGreaterThan(0);
  });
});
