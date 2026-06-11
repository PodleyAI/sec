/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CrowdfundingRepo } from "../../../storage/portal/CrowdfundingRepo";
import { Form_C } from "./Form_C";
import { determineStatus, processFormC } from "./Form_C.storage";
import {
  accessionFromFixtureName,
  assertAllSucceeded,
  deriveFileNumber,
  listFixtureFiles,
  runPipeline,
  safeCikToInt,
} from "./pipeline-test-util";

const CASES = [
  { slug: "form-c-u", form: "C-U" as const, status: "progress-update" },
  { slug: "form-c-ar", form: "C-AR" as const, status: "annual-report" },
  { slug: "form-c-tr", form: "C-TR" as const, status: "termination" },
];

describe("determineStatus", () => {
  // The -W post-offering codes withdraw the referenced filing, not the
  // offering: blanket "withdrawn" (or the base status) would misstate it.
  const EXPECTED: ReadonlyArray<[string, string]> = [
    ["C", "active"],
    ["C/A", "amended"],
    ["C-W", "withdrawn"],
    ["C/A-W", "amended"],
    ["C-U", "progress-update"],
    ["C-U-W", "progress-update-withdrawn"],
    ["C-AR", "annual-report"],
    ["C-AR/A", "annual-report"],
    ["C-AR-W", "annual-report-withdrawn"],
    ["C-AR/A-W", "annual-report-withdrawn"],
    ["C-TR", "termination"],
    ["C-TR-W", "termination-withdrawn"],
  ];

  for (const [code, expected] of EXPECTED) {
    it(`maps ${code} -> ${expected}`, () => {
      expect(determineStatus(code)).toBe(expected);
    });
  }
});

describe("Form C post-offering pipeline (C-U / C-AR / C-TR)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  for (const { slug, form, status } of CASES) {
    it(`stores every ${form} fixture and round-trips status "${status}"`, async () => {
      const files = listFixtureFiles(slug);
      expect(files.length).toBeGreaterThan(0);
      const ciks: number[] = [];

      const summary = await runPipeline(slug, async (file, xml) => {
        const parsed = await Form_C.parse(form, xml);
        const accession = accessionFromFixtureName(file);
        const cik = safeCikToInt(parsed.headerData.filerInfo.filer.filerCredentials.filerCik);
        ciks.push(cik);
        await processFormC({
          cik,
          file_number: deriveFileNumber(accession),
          accession_number: accession,
          filing_date: "2025-04-28",
          primary_doc: "primary_doc.xml",
          formC: parsed,
        });
      });
      assertAllSucceeded(summary);

      const repo = new CrowdfundingRepo();
      const rows = await repo.getCrowdfundingByCik(ciks[0]);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].status).toBe(status);
    });
  }
});
