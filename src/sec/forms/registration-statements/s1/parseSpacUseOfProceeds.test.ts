/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseSpacUseOfProceeds } from "./parseSpacUseOfProceeds";

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
    expect(
      rows.find((r) => r.purpose?.startsWith("Underwriting discounts"))?.amount
    ).toBe(4_500_000);
  });

  it("returns empty when fewer than two amount lines exist", () => {
    const text = [
      "| Legal fees and expenses | $ | 325,000 |",
      "| --- | --- | --- |",
    ].join("\n");
    expect(parseSpacUseOfProceeds(text)).toEqual([]);
  });
});
