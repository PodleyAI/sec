/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { parseQuarterlyFormIdx } from "./FetchQuarterlyFormIdxTask";

describe("parseQuarterlyFormIdx", () => {
  const sampleIdx = [
    "Description:           Master Index of EDGAR Dissemination Feed by Form Type",
    "Last Data Received:    March 31, 2025",
    "",
    "",
    "Form Type   Company Name                                                  CIK         Date Filed  File Name",
    "---------------------------------------------------------------------------------------------------------------------------------------------",
    "1-A              Algernon Neuroscience Inc.                                    1959708     2025-01-24  edgar/data/1959708/0001062993-25-001035.txt",
    "D                Acme Capital LLC                                              1234567     2025-02-01  edgar/data/1234567/0001234567-25-000001.txt",
    "D/A              Beta Funds, LP                                                2345678     2025-02-15  edgar/data/2345678/0002345678-25-000002.txt",
    "C-W              Gamma Holdings                                                3456789     2025-03-01  edgar/data/3456789/0003456789-25-000003.txt",
    "",
  ].join("\n");

  it("returns one typed row per filing past the preamble divider", () => {
    const rows = parseQuarterlyFormIdx(sampleIdx);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      formType: "1-A",
      companyName: "Algernon Neuroscience Inc.",
      cik: 1959708,
      dateFiled: "2025-01-24",
      fileName: "edgar/data/1959708/0001062993-25-001035.txt",
    });
    expect(rows[2].formType).toBe("D/A");
    expect(rows[3].formType).toBe("C-W");
  });

  it("returns an empty array when the header divider is missing", () => {
    expect(parseQuarterlyFormIdx("garbage with no divider\n")).toEqual([]);
  });

  it("skips rows that don't have all five columns", () => {
    const idx = [
      "Form Type",
      "---",
      "INCOMPLETE ROW",
      "D    Acme    1234567    2025-02-01    edgar/data/1234567/0001234567-25-000001.txt",
    ].join("\n");
    const rows = parseQuarterlyFormIdx(idx);
    expect(rows).toHaveLength(1);
    expect(rows[0].formType).toBe("D");
    expect(rows[0].cik).toBe(1234567);
  });

  it("skips rows whose CIK column isn't numeric", () => {
    const idx = [
      "---",
      "D    Acme    NOT_A_CIK    2025-02-01    edgar/data/x/y.txt",
      "D    Beta    1234567      2025-02-02    edgar/data/x/z.txt",
    ].join("\n");
    const rows = parseQuarterlyFormIdx(idx);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyName).toBe("Beta");
  });
});
