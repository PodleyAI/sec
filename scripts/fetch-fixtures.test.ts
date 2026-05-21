/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for the pure helpers in scripts/fetch-fixtures.ts. The
 * form.idx parser itself is tested next to its task in
 * src/task/index/FetchQuarterlyFormIdxTask.test.ts; this file covers the
 * accession/URL/slug helpers that the script keeps on top of the task
 * layer.
 */

import { describe, expect, it } from "bun:test";
import {
  accessionFromFileName,
  accessionWithoutDashes,
  fixturePath,
  primaryDocUrl,
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
      expect(primaryDocUrl(1959708, "0001062993-25-001035")).toBe(
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
});
