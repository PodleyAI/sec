/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import {
  accessionFromFileName,
  accessionWithoutDashes,
  parseFormIdx,
  primaryDocUrl,
  fixturePath,
} from "./fetch-fixtures";

describe("fetch-fixtures helpers", () => {
  describe("accession parsing", () => {
    it("strips path and extension from a form.idx fileName", () => {
      expect(accessionFromFileName("edgar/data/1959708/0001062993-25-001035.txt")).toBe(
        "0001062993-25-001035"
      );
    });

    it("returns empty when fileName is empty", () => {
      expect(accessionFromFileName("")).toBe("");
    });

    it("strips dashes for the URL-style accession", () => {
      expect(accessionWithoutDashes("0001062993-25-001035")).toBe("000106299325001035");
    });
  });

  describe("primaryDocUrl", () => {
    it("composes the canonical primary_doc.xml URL", () => {
      expect(primaryDocUrl("1959708", "0001062993-25-001035")).toBe(
        "https://www.sec.gov/Archives/edgar/data/1959708/000106299325001035/primary_doc.xml"
      );
    });
  });

  describe("fixturePath", () => {
    it("maps a form type to its mock_data slug and accession-style filename", () => {
      const p = fixturePath("D", "0001234567-25-000001");
      expect(p).toMatch(/mock_data\/form-d\/000123456725000001-primary_doc\.xml$/);
    });

    it("uses the C-W slug for Form C withdrawals", () => {
      const p = fixturePath("C-W", "0001234567-25-000002");
      expect(p).toMatch(/mock_data\/form-c-w\/000123456725000002-primary_doc\.xml$/);
    });

    it("uses the 1-A POS slug for post-qualification amendments", () => {
      const p = fixturePath("1-A POS", "0001234567-25-000003");
      expect(p).toMatch(/mock_data\/form-1-a-pos\/000123456725000003-primary_doc\.xml$/);
    });

    it("throws for unknown form types", () => {
      expect(() => fixturePath("UNKNOWN-FORM", "x")).toThrow(/No slug/);
    });
  });

  describe("parseFormIdx", () => {
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

    it("skips the preamble and returns one row per filing", () => {
      const rows = parseFormIdx(sampleIdx);
      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual({
        formType: "1-A",
        companyName: "Algernon Neuroscience Inc.",
        cik: "1959708",
        dateFiled: "2025-01-24",
        fileName: "edgar/data/1959708/0001062993-25-001035.txt",
      });
      expect(rows[2].formType).toBe("D/A");
      expect(rows[3].formType).toBe("C-W");
    });

    it("returns an empty array when the header divider is missing", () => {
      expect(parseFormIdx("garbage with no divider\n")).toEqual([]);
    });

    it("ignores rows that don't have all 5 columns", () => {
      const idx = [
        "Form Type",
        "---",
        "INCOMPLETE ROW",
        "D    Acme    1234567    2025-02-01    edgar/data/1234567/0001234567-25-000001.txt",
      ].join("\n");
      const rows = parseFormIdx(idx);
      expect(rows).toHaveLength(1);
      expect(rows[0].formType).toBe("D");
    });
  });
});
