/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sweep's selector, on the repository path.
 *
 * That path is the one the two raw-SQL fast paths exist to avoid, and so the
 * one nothing else exercises — which is how it shipped asking the document
 * store for a row with an ARRAY primary key when the storage takes an object.
 * Every lookup missed, so every filing looked unconverted and the sweep would
 * have re-converted the whole corpus on every run, forever, at full cost.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { selectFilingsToConvert } from "./selectFilingsToConvert";

const CIK = 1811882;
const VERSION = "1";

const filing = (accession: string, form: string, filingDate: string) => ({
  cik: CIK,
  accession_number: accession,
  filing_date: filingDate,
  report_date: null,
  acceptance_date: `${filingDate}T12:00:00.000Z`,
  form,
  file_number: "333-1",
  film_number: null,
  act: null,
  size: null,
  is_xbrl: null,
  is_inline_xbrl: null,
  primary_doc: "doc.htm",
  primary_doc_description: null,
  items: null,
});

async function markConverted(accession: string, version: string): Promise<void> {
  await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).put({
    cik: CIK,
    accession_number: accession,
    doc_file: "doc.htm",
    form: "S-1",
    filing_date: "2026-02-01",
    title: "S-1",
    section_count: 3,
    char_count: 100,
    converter_version: version,
    converted_at: "2026-08-01T00:00:00.000Z",
  });
}

describe("selectFilingsToConvert (repository path)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await filings.setupDatabase();
    await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).setupDatabase();
    await filings.putBulk([
      filing("0001213900-26-000001", "S-1", "2026-02-01"),
      filing("0001213900-26-000002", "S-1/A", "2026-03-01"),
      // Not a narrative form, so never selected.
      filing("0001213900-26-000003", "4", "2026-03-02"),
    ]);
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  const select = (over: Partial<Parameters<typeof selectFilingsToConvert>[0]> = {}) =>
    selectFilingsToConvert({ limit: 10, converterVersion: VERSION, ...over });

  it("selects the narrative forms, newest first", async () => {
    const rows = await select();
    expect(rows.map((r) => r.form)).toEqual(["S-1/A", "S-1"]);
  });

  it("skips a filing already converted at the current version", async () => {
    await markConverted("0001213900-26-000002", VERSION);
    const rows = await select();
    expect(rows.map((r) => r.accession_number)).toEqual(["0001213900-26-000001"]);
  });

  it("re-selects a filing converted at an older version", async () => {
    // A converter bump is what makes a stored row stale, and re-running is what
    // replaces it — the alternative being a truncate that leaves a hole.
    await markConverted("0001213900-26-000002", "0");
    const rows = await select();
    expect(rows.map((r) => r.accession_number)).toContain("0001213900-26-000002");
  });

  it("re-selects everything under force", async () => {
    await markConverted("0001213900-26-000001", VERSION);
    await markConverted("0001213900-26-000002", VERSION);
    expect(await select()).toHaveLength(0);
    expect(await select({ force: true })).toHaveLength(2);
  });

  it("honours the date floor, the form list and the limit", async () => {
    expect((await select({ since: "2026-02-15" })).map((r) => r.form)).toEqual(["S-1/A"]);
    expect((await select({ forms: ["S-1"] })).map((r) => r.form)).toEqual(["S-1"]);
    expect(await select({ limit: 1 })).toHaveLength(1);
  });

  it("asks for nothing when asked for nothing", async () => {
    expect(await select({ limit: 0 })).toEqual([]);
    expect(await select({ forms: [] })).toEqual([]);
  });
});
