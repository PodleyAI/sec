/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { trimExecutiveCompensationSectionText } from "./trimExecutiveCompensationSection";

const sctAndNarrative = [
  "Summary Compensation Table",
  "",
  "| Name | Year | Salary | Total |",
  "| Jane Roe | 2025 | 400000 | 500000 |",
  "",
  "Narrative Disclosure to Summary Compensation Table",
  "",
  "Ms. Roe's salary was set by the compensation committee.",
].join("\n");

const fluff = [
  "Outstanding Equity Awards at Fiscal Year-End",
  "",
  "| Name | Options |",
  "| Jane Roe | 10000 |",
  "",
  "Director Compensation",
  "",
  "| Name | Fees |",
  "| John Doe | 50000 |",
].join("\n");

describe("trimExecutiveCompensationSectionText", () => {
  it("keeps the Summary Compensation Table; drops later Item 402 fluff", () => {
    const input = `${sctAndNarrative}\n\n${fluff}`;
    const out = trimExecutiveCompensationSectionText(input);
    expect(out).toContain("Summary Compensation Table");
    expect(out).toContain("Jane Roe");
    expect(out).toContain("Ms. Roe's salary");
    expect(out).not.toContain("Outstanding Equity Awards");
    expect(out).not.toContain("Director Compensation");
  });

  it("returns text unchanged when no stop heading is present", () => {
    expect(trimExecutiveCompensationSectionText(sctAndNarrative)).toBe(sctAndNarrative);
  });

  it("ignores a stop heading in the first 8% of the section", () => {
    const early = "Director Compensation\n\n" + "x".repeat(5000);
    const late = `\n\nOutstanding Equity Awards at Fiscal Year-End\n\nmore fluff`;
    const input = early + late;
    const out = trimExecutiveCompensationSectionText(input);
    expect(out.startsWith("Director Compensation")).toBe(true);
    expect(out).not.toContain("more fluff");
  });

  it("cuts at the earliest matching stop heading", () => {
    const input = [
      sctAndNarrative,
      "",
      "Employment Agreements",
      "",
      "We have entered into employment agreements.",
      "",
      "Director Compensation",
      "",
      "Director fees.",
    ].join("\n");
    const out = trimExecutiveCompensationSectionText(input);
    expect(out).toContain("Jane Roe");
    expect(out).not.toContain("We have entered into employment agreements");
    expect(out).not.toContain("Director fees");
  });
});
