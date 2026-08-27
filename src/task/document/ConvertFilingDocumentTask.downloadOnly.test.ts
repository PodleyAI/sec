/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `--download-only`: the fetch happens, nothing else does.
 *
 * The point of the mode is that the two halves of the leaf have different
 * costs — the download is metered by EDGAR and runs for hours, the conversion
 * is local — so the guarantee worth pinning is that the cheap half leaves NO
 * trace in the database. A regression here is silent: the sweep would still
 * report success, and the rows it wrote would only surface later as a filing
 * marked converted at a version whose parser never ran on it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import { FILING_SECTION_REPOSITORY_TOKEN } from "../../storage/document/FilingSectionSchema";
import {
  ConvertFilingDocumentTask,
  type ConvertFilingDocumentTaskInput,
} from "./ConvertFilingDocumentTask";

const CIK = 1811882;
const ACCESSION = "0001213900-26-000001";

const HEADING = 'style="font-weight:700;text-align:center;font-size:14pt"';
const BODY = `<html><body>
  <p>Cover page of the offering.</p>
  <p ${HEADING}>RISK FACTORS</p>
  <p>Investing involves risk.</p>
</body></html>`;

/**
 * Stands in for the filesystem and the network at the seam the task documents
 * for exactly this. `fromCache` is the value under test as much as the rows
 * are: it is what the sweep counts to tell an operator whether a slow run is
 * EDGAR or the parser.
 */
class StubbedConvert extends ConvertFilingDocumentTask {
  public loadCalls = 0;
  constructor(
    defaults: ConvertFilingDocumentTaskInput,
    private readonly fromCache: boolean
  ) {
    super({ defaults });
  }
  protected override async loadSource(
    _input: ConvertFilingDocumentTaskInput,
    _context: IExecuteContext
  ): Promise<{ text: string; docFile: string; fromCache: boolean } | undefined> {
    this.loadCalls += 1;
    return { text: BODY, docFile: "doc.htm", fromCache: this.fromCache };
  }
}

describe("ConvertFilingDocumentTask --download-only", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await globalServiceRegistry.get(FILING_SECTION_REPOSITORY_TOKEN).setupDatabase();
    await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).setupDatabase();
  });

  const rowCounts = async (): Promise<{ sections: number; documents: number }> => ({
    sections:
      (await globalServiceRegistry.get(FILING_SECTION_REPOSITORY_TOKEN).getAll())?.length ?? 0,
    documents:
      (await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).getAll())?.length ?? 0,
  });

  it("loads the source and writes nothing", async () => {
    const task = new StubbedConvert(
      { cik: CIK, accessionNumber: ACCESSION, form: "S-1", downloadOnly: true },
      false
    );
    const out = await task.run();

    expect(task.loadCalls).toBe(1);
    expect(out.success).toBe(true);
    expect(out.sections).toBe(0);
    expect(out.documents).toBe(0);
    expect(out.fromCache).toBe(false);
    expect(await rowCounts()).toEqual({ sections: 0, documents: 0 });
  });

  it("reports a cache hit as one, so a no-network run is distinguishable", async () => {
    const out = await new StubbedConvert(
      { cik: CIK, accessionNumber: ACCESSION, form: "S-1", downloadOnly: true },
      true
    ).run();
    expect(out.fromCache).toBe(true);
  });

  it("still converts and stores when the mode is off", async () => {
    // The control: the same fixture through the same seam has to produce rows,
    // or the assertion above would pass for the wrong reason.
    const out = await new StubbedConvert(
      { cik: CIK, accessionNumber: ACCESSION, form: "S-1" },
      true
    ).run();

    expect(out.success).toBe(true);
    expect(out.sections).toBeGreaterThan(0);
    const counts = await rowCounts();
    expect(counts.sections).toBeGreaterThan(0);
    expect(counts.documents).toBeGreaterThan(0);
  });
});
