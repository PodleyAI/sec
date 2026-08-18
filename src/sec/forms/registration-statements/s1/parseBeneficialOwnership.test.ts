/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseBeneficialOwnership } from "./parseBeneficialOwnership";

const SPAC = [
  "PRINCIPAL STOCKHOLDERS",
  "| Name and Address of Beneficial Owner(1) | Number of Shares Beneficially Owned(2) | Approximate Percentage |",
  "| --- | --- | --- |",
  "| Halyard Sponsor III LLC(our sponsor)(3) | 4,312,500 | 100.0% |",
  "| Eleanor Vasquez(3)(4) | 4,312,500 | 100.0% |",
  "| Desmond Achebe | — | — |",
  "| Marta Lindqvist(4) | — | — |",
  "| Peter Sandoval-Reyes(4) | 43,125 | * |",
  "| All officers and directors as a group (five individuals) | 4,355,625 | 100.0% |",
].join("\n");

const COLSPAN = [
  "| Name and Address of Beneficial Owner(1) | Name and Address of Beneficial Owner(1) | Amount and Nature of Beneficial Ownership | Approximate Percentage |",
  "| Southern Cross Acquisition II Sponsor Corp. (3) | Southern Cross Acquisition II Sponsor Corp. (3) | 2,820,000 | 98.09 | % |",
  "| Peizhong Yu | Peizhong Yu | 2,820,000 | 98.09 | % |",
  "| Principal Shareholders (5% or more) |  |  |  |",
  "| Ally Tong Zhang | Ally Tong Zhang | 15,000 | * | % |",
  "| All directors and executive officers (five individuals) as a | 2,875,000 | 100 | % |",
].join("\n");

const HEADERLESS = ["PRINCIPAL AND SELLING STOCKHOLDERS", "| ACME Fund | 1,000,000 | 12.5% |"].join(
  "\n"
);

describe("parseBeneficialOwnership", () => {
  it("never throws", () => {
    expect(parseBeneficialOwnership("")).toEqual([]);
    expect(parseBeneficialOwnership("|  |")).toEqual([]);
  });

  it("reads a SPAC table, keeps dash rows, and drops the group subtotal", () => {
    const rows = parseBeneficialOwnership(SPAC);
    expect(rows.map((r) => [r.name, r.owner_kind, r.shares_owned, r.percent_owned])).toEqual([
      ["Halyard Sponsor III LLC", "company", 4312500, 100],
      ["Eleanor Vasquez", "person", 4312500, 100],
      ["Desmond Achebe", "person", null, null],
      ["Marta Lindqvist", "person", null, null],
      ["Peter Sandoval-Reyes", "person", 43125, null],
    ]);
    expect(rows.every((r) => r.source === "deterministic")).toBe(true);
  });

  it("collapses colspan copies and skips captions plus truncated group rows", () => {
    const rows = parseBeneficialOwnership(COLSPAN);
    expect(rows.map((r) => r.name)).toEqual([
      "Southern Cross Acquisition II Sponsor Corp.",
      "Peizhong Yu",
      "Ally Tong Zhang",
    ]);
    expect(rows[0]!.owner_kind).toBe("company");
    expect(rows[0]!.shares_owned).toBe(2820000);
    expect(rows[0]!.percent_owned).toBe(98.09);
  });

  it("does not parse a headerless grid", () => {
    expect(parseBeneficialOwnership(HEADERLESS)).toEqual([]);
  });

  it("peels a glued title and c/o address off the owner name", () => {
    const text = [
      "| Name and Address of Beneficial Owner | Number of Shares Beneficially Owned | Percent |",
      "| Martin J. Shen, Chief Executive Officer c/o 111 Somerset Road, Level 3, Singapore, 238164 | 1,000,000 | 10.0% |",
    ].join("\n");
    const rows = parseBeneficialOwnership(text);
    expect(rows.map((r) => r.name)).toEqual(["Martin J. Shen"]);
  });

  it("reads a split Name-row header above Before/After share columns", () => {
    const text = [
      "| Number of SharesBeneficially Owned(2) | Number of SharesBeneficially Owned(2) | Number of SharesBeneficially Owned(2) |",
      "| BeforeOffering | AfterOffering | BeforeOffering |",
      "| Name and Address of Beneficial Owner(1) |  |  |",
      "| Europe Acquisition Holdings Limited(3)(4) | 5,899,583 | 5,141,771 | 82.1 | % | 16.5 |",
      "| Hazem Ben-Gacem | — |  |  |",
      "| Peter McKellar(5)(6) | 479,167 | 407,292 | 6.7 | % | 1.3 |",
      "| All officers, directors and director nominees as a group(8 individuals | 1,287,917 | 1,108,229 | 17.9 | % |",
    ].join("\n");
    const rows = parseBeneficialOwnership(text);
    expect(rows.map((r) => [r.name, r.shares_owned])).toEqual([
      ["Europe Acquisition Holdings Limited", 5899583],
      ["Hazem Ben-Gacem", null],
      ["Peter McKellar", 479167],
    ]);
  });
});
