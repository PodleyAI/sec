/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseSpacUnderwriters } from "./parseSpacUnderwriters";

function names(text: string): string[] {
  return parseSpacUnderwriters(text).map((r) => r.legal_name);
}

describe("parseSpacUnderwriters", () => {
  it("never throws", () => {
    expect(parseSpacUnderwriters("")).toEqual([]);
    expect(parseSpacUnderwriters("not a table")).toEqual([]);
    expect(parseSpacUnderwriters("| |\n| --- |")).toEqual([]);
  });

  it("reads a sole book-runner allocation table", () => {
    const text = [
      "| Underwriter | Number of Units |",
      "| --- | --- |",
      "| Cantor Fitzgerald & Co. | |",
      "| Total | 20,000,000 |",
    ].join("\n");
    const rows = parseSpacUnderwriters(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.legal_name).toBe("Cantor Fitzgerald & Co.");
    expect(rows[0]!.shares_allocated).toBeNull();
    expect(rows[0]!.source).toBe("deterministic");
    expect(text.includes(rows[0]!.source_span)).toBe(true);
  });

  it("reads several syndicate names and skips Total and the discount table", () => {
    const text = [
      "| Underwriters | Number of Units | Number of Units |",
      "| --- | --- | --- |",
      "| Credit Suisse Securities (USA) LLC | | |",
      "| BofA Securities, Inc. | | |",
      "| Moelis & Company LLC. | | |",
      "| Total | | 35,000,000 |",
      "| Per Unit | Without Over-allotment | With Over-allotment |",
      "| Underwriting Discounts and Commissions paid by us | $0.55 | $19,250,000 |",
    ].join("\n");
    expect(names(text)).toEqual([
      "Credit Suisse Securities (USA) LLC",
      "BofA Securities, Inc.",
      "Moelis & Company LLC",
    ]);
  });

  it("takes shares_allocated from the first numeric units column", () => {
    const text = [
      "| Underwriter | Number of Units |",
      "| --- | --- |",
      "| Citigroup Global Markets Inc. | 30,000,000 |",
      "| Total | 30,000,000 |",
    ].join("\n");
    expect(parseSpacUnderwriters(text)[0]!.shares_allocated).toBe(30_000_000);
  });

  it("ignores an over-allotment third column when the first units cell is empty", () => {
    const text = [
      "| Underwriter | Number of units | Number of units |",
      "| --- | --- | --- |",
      "| Barclays Capital Inc. | | 25,875,000 |",
      "| Total | | 25,875,000 |",
    ].join("\n");
    expect(parseSpacUnderwriters(text)[0]!.shares_allocated).toBeNull();
    expect(parseSpacUnderwriters(text)[0]!.over_allotment_shares).toBeNull();
  });

  it("strips a footnote marker from a legal name", () => {
    const text = [
      "| Underwriter | Number of Units |",
      "| --- | --- |",
      "| Nomura Securities International, Inc.(1) | |",
      "| Total | 1 |",
    ].join("\n");
    expect(names(text)).toEqual(["Nomura Securities International, Inc."]);
  });

  it("drops a placeholder name cell", () => {
    const text = [
      "| Underwriter | Number of Units |",
      "| --- | --- |",
      "| [●] | |",
      "| Total | 7,500,000 |",
    ].join("\n");
    expect(names(text)).toEqual([]);
  });

  it("splits a comma-and list of firm names in one cell", () => {
    const text = [
      "| Underwriters | Number of Units |",
      "| --- | --- |",
      "| Lucid Capital Markets, LLC and EarlyBirdCapital, Inc. | 10,000,000 |",
      "| Total | 10,000,000 |",
    ].join("\n");
    expect(names(text)).toEqual(["Lucid Capital Markets, LLC", "EarlyBirdCapital, Inc."]);
  });

  it("does not split 'BofA Securities, Inc.' on the Inc comma", () => {
    const text = [
      "| Underwriter | Number of Units |",
      "| --- | --- |",
      "| BofA Securities, Inc. | |",
      "| Total | 1 |",
    ].join("\n");
    expect(names(text)).toEqual(["BofA Securities, Inc."]);
  });

  it("drops a family prefix echo of a longer legal name", () => {
    const text = [
      "| Underwriter | Number of Units |",
      "| --- | --- |",
      "| Cantor | |",
      "| Cantor Fitzgerald & Co. | |",
      "| Total | 20,000,000 |",
    ].join("\n");
    expect(names(text)).toEqual(["Cantor Fitzgerald & Co."]);
  });

  it("reads a headerless allocation table whose caption is in the prose", () => {
    const text = [
      "the underwriters below have agreed to purchase from us:",
      "|  |  |",
      "| --- | --- |",
      "| US Tiger Securities, Inc. |  |",
      "| Total | 10,000,000 |",
    ].join("\n");
    expect(names(text)).toEqual(["US Tiger Securities, Inc."]);
  });

  it("keeps a long division-of legal name", () => {
    const text = [
      "| Underwriters | Number of Units |",
      "| --- | --- |",
      "| EF Hutton, division of Benchmark Investments, LLC formerly known as Kingswood Capital Markets, division of Benchmark Investments | |",
      "| Total | 10,000,000 |",
    ].join("\n");
    expect(names(text)[0]).toMatch(/^EF Hutton/);
  });

  it("does not take a prose fragment from a two-column layout table", () => {
    const text = [
      "| Underwriter | Number of Units |",
      "| --- | --- |",
      "| R.F. Lafferty & Co., Inc. | |",
      "| our financial information, | |",
      "| Total | 10,000,000 |",
    ].join("\n");
    expect(names(text)).toEqual(["R.F. Lafferty & Co., Inc."]);
  });

  it("does not take a selling stockholder table", () => {
    const text = [
      "| Selling Stockholder | Number of Shares |",
      "| --- | --- |",
      "| Acme Holdings LLC | 1,000,000 |",
    ].join("\n");
    expect(names(text)).toEqual([]);
  });

  it("does not take a statutory-underwriter / may-be-deemed table", () => {
    const text = [
      "| Name | Role |",
      "| --- | --- |",
      "| Jane Doe | may be deemed an underwriter |",
    ].join("\n");
    expect(names(text)).toEqual([]);
  });

  it("does not take Plan of Distribution bullet methods as names", () => {
    const text = [
      "|  |  |",
      "| --- | --- |",
      "| ● | ordinary brokerage transactions and transactions in which the broker-dealer solicits purchasers; |",
      "| ● | block trades in which the broker-dealer will attempt to sell the securities as agent; |",
    ].join("\n");
    expect(names(text)).toEqual([]);
  });

  it("does not persist a QIU-only table", () => {
    const text = [
      "| Qualified Independent Underwriter | Fee |",
      "| --- | --- |",
      "| B. Riley Securities, Inc. | $50,000 |",
    ].join("\n");
    expect(names(text)).toEqual([]);
  });

  it("persists a QIU when a syndicate table also named another bank", () => {
    const text = [
      "| Underwriters | Number of Units |",
      "| --- | --- |",
      "| Chardan Capital Markets LLC | |",
      "| Total | 7,500,000 |",
      "| Qualified Independent Underwriter | |",
      "| --- | --- |",
      "| B. Riley Securities, Inc. | |",
    ].join("\n");
    expect(names(text)).toEqual(["Chardan Capital Markets LLC", "B. Riley Securities, Inc."]);
  });

  it("sets role null even when the table is a sole book-runner", () => {
    const text = [
      "| Underwriter | Number of Units |",
      "| --- | --- |",
      "| WestPark Capital, Inc. | 6,000,000 |",
      "| Total | 6,000,000 |",
    ].join("\n");
    expect(parseSpacUnderwriters(text)[0]!.role).toBeNull();
  });
});
