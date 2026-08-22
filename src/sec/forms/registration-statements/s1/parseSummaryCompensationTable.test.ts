/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseSummaryCompensationTable } from "./parseSummaryCompensationTable";

const TWO_YEAR = [
  "Summary Compensation Table",
  "",
  "| Name and Principal Position | Year | Year | Salary ($) | Salary ($) | Bonus ($)(1) | Bonus ($)(1) | Option awards ($)(2) | Option awards ($)(2) | All other compensation ($)(3) | All other compensation ($)(3) | Total ($) | Total ($) |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| Alina Kowalczyk |  | 2025 |  | 612,500 |  | 425,000 |  | 3,180,400 |  | 12,300 |  | 4,230,200 |",
  "| Chief Executive Officer |  | 2024 |  | 570,000 |  | 285,000 |  | 1,940,000 |  | 11,800 |  | 2,806,800 |",
  "| Bertrand Osei |  | 2025 |  | 448,750 |  | 224,375 |  | 1,102,600 |  | 9,450 |  | 1,785,175 |",
  "| Chief Operating Officer |  | 2024 |  | 420,000 |  | 168,000 |  | 640,500 |  | 9,100 |  | 1,237,600 |",
  "| Chandra Villanueva |  | 2025 |  | 415,000 |  | 207,500 |  | 968,300 |  | 9,450 |  | 1,600,250 |",
  "| Chief Financial Officer |  | 2024 |  | 390,000 |  | 156,000 |  | 512,000 |  | 8,900 |  | 1,066,900 |",
].join("\n");

const WITH_DIRECTOR = [
  "Summary Compensation Table",
  "",
  "| Name and Principal Position | Year | Salary ($) | Salary ($) | Bonus ($) | Bonus ($) | Stock awards ($)(1) | Stock awards ($)(1) | All other compensation ($) | All other compensation ($) | Total ($) | Total ($) |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| Halvard Nilsen(2) | 2025 |  | 325,000 |  | — |  | 748,000 |  | 14,200 |  | 1,087,200 |",
  "| President and Chief Executive Officer |  |  |  |  |  |  |  |  |  |  |  |",
  "| Renata Oyelaran | 2025 |  | 285,000 |  | 57,000 |  | 412,500 |  | 13,650 |  | 768,150 |",
  "| Chief Financial Officer |  |  |  |  |  |  |  |  |  |  |  |",
  "",
  "Director Compensation",
  "",
  "| Name | Fees Earned or Paid in Cash ($) | Stock awards ($) | Total ($) |",
  "| --- | --- | --- | --- |",
  "| Tobias Brennan | 45,000 | 120,000 | 165,000 |",
  "| Yuki Tanabe | 42,500 | 120,000 | 162,500 |",
].join("\n");

describe("parseSummaryCompensationTable", () => {
  it("never throws", () => {
    expect(parseSummaryCompensationTable("")).toEqual([]);
    expect(parseSummaryCompensationTable("|  |")).toEqual([]);
  });

  it("reads two fiscal years per officer and folds the position line", () => {
    const rows = parseSummaryCompensationTable(TWO_YEAR);
    expect(rows.map((r) => [r.person_name, r.fiscal_year, r.salary, r.total])).toEqual([
      ["Alina Kowalczyk", 2025, 612500, 4230200],
      ["Alina Kowalczyk", 2024, 570000, 2806800],
      ["Bertrand Osei", 2025, 448750, 1785175],
      ["Bertrand Osei", 2024, 420000, 1237600],
      ["Chandra Villanueva", 2025, 415000, 1600250],
      ["Chandra Villanueva", 2024, 390000, 1066900],
    ]);
    expect(rows[1]!.principal_position).toBe("Chief Executive Officer");
    expect(rows.every((r) => r.source === "deterministic")).toBe(true);
  });

  it("does not emit director-table rows or a position line with no year", () => {
    const rows = parseSummaryCompensationTable(WITH_DIRECTOR);
    expect(rows.map((r) => r.person_name)).toEqual(["Halvard Nilsen", "Renata Oyelaran"]);
    expect(rows.map((r) => r.fiscal_year)).toEqual([2025, 2025]);
    expect(rows[0]!.bonus).toBeNull();
    expect(rows[0]!.salary).toBe(325000);
    expect(rows[0]!.principal_position).toBe("President and Chief Executive Officer");
  });

  it("reads a Period/$ spacer table with zero salaries", () => {
    const text = [
      "Summary Compensation Table",
      "| Name and Principal’s | Name and Principal’s | Name and Principal’s |",
      "| Position | Period | $ |",
      "| Jimmy Ramirez | 2020 | 0 |",
      "| Pres/Director | 2019 | 0 |",
      "| Franklin Ogele, Snr | 2020 | 0 |",
      "| VP/GC/CFO | 2019 | 0 |",
    ].join("\n");
    const rows = parseSummaryCompensationTable(text);
    expect(rows.map((r) => [r.person_name, r.fiscal_year, r.salary])).toEqual([
      ["Jimmy Ramirez", 2020, 0],
      ["Jimmy Ramirez", 2019, 0],
      ["Franklin Ogele, Snr", 2020, 0],
      ["Franklin Ogele, Snr", 2019, 0],
    ]);
  });

  it("ignores an employment-agreement table that has Salary but no Year", () => {
    const text = [
      "Employment Agreements",
      "| Name | Position(s) | Term | Salary | Salary | Salary |",
      "| Ronald W. Pickett | Chief Executive Officer | 1 year | $ | 200,000 | Board Discretionary |",
      "| Robert P. Crabb | Secretary | 1 year | $ | 30,000 | None |",
    ].join("\n");
    expect(parseSummaryCompensationTable(text)).toEqual([]);
  });

  it("does not treat a wrapped title fragment as an officer", () => {
    const text = [
      "Summary Compensation Table",
      "| Name and Principal Position | Year | Salary ($) | Total ($) |",
      "| Siyu Huang, Ph.D., MBA | 2025 | 200,000 | 1,688,189 |",
      "| Founder and |  |  |  |",
      "| Chief Executive Officer |  |  |  |",
    ].join("\n");
    const rows = parseSummaryCompensationTable(text);
    expect(rows.map((r) => r.person_name)).toEqual(["Siyu Huang, Ph.D., MBA"]);
  });

  it("reads a Name/Title/BaseSalary table without a year column", () => {
    const text = [
      "Summary Compensation Table",
      "| Name | Title | Title | Title | Title | BaseSalary |",
      "| Phillip Juhan |  | Chief Financial Officer | $ | 145,455 | (1) |",
      "| Andrew Northwall |  | Chief Operating Officer | $ | 12,674 | (2) |",
    ].join("\n");
    const rows = parseSummaryCompensationTable(text);
    expect(rows.map((r) => [r.person_name, r.salary, r.principal_position])).toEqual([
      ["Phillip Juhan", 145455, "Chief Financial Officer"],
      ["Andrew Northwall", 12674, "Chief Operating Officer"],
    ]);
  });
});
