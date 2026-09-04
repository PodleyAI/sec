/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { selectFilingsToConvert } from "./selectFilingsToConvert";

const VERSION = "3";

const CIK = 1083743;

const filing = (accession: string) => ({
  cik: CIK,
  accession_number: accession,
  filing_date: "2026-03-01",
  acceptance_date: "2026-03-01T12:00:00.000Z",
  form: "8-K",
  primary_doc: "form8k.htm",
});

const documentRow = (accession: string, docFile: string, isPrimary: boolean) => ({
  cik: CIK,
  accession_number: accession,
  doc_file: docFile,
  doc_type: isPrimary ? "8-K" : "EX-99.1",
  description: null,
  sequence: isPrimary ? 1 : 2,
  is_primary: isPrimary,
  form: "8-K",
  filing_date: "2026-03-01",
  title: `8-K ${accession}`,
  section_count: 3,
  char_count: 900,
  converter_version: VERSION,
  converted_at: "2026-03-02T00:00:00.000Z",
});

/**
 * The anti-join now excludes a filing only when its PRIMARY document row is
 * stored at the current version, and `is_primary` is a boolean column compared
 * in raw SQL. Booleans have no native SQLite type, so what the driver writes
 * and what the hand-written comparison reads have to agree — on the in-memory
 * repository they trivially do, and a mismatch here would either re-convert the
 * whole corpus on every sweep or skip every submission whose exhibits landed
 * before an interruption.
 */
describe("selectFilingsToConvert primary gate (sqlite)", () => {
  withSqliteDb("select_filings_to_convert_sqlite_test", [
    FILING_REPOSITORY_TOKEN,
    FILING_DOCUMENT_REPOSITORY_TOKEN,
  ]);

  it("skips a filing whose primary document is stored, and keeps one with only exhibits", async () => {
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const documents = globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);

    await filings.put(filing("0001493152-26-000001") as never);
    await filings.put(filing("0001493152-26-000002") as never);
    await filings.put(filing("0001493152-26-000003") as never);

    // Fully converted: primary present.
    await documents.put(documentRow("0001493152-26-000001", "form8k.htm", true));
    await documents.put(documentRow("0001493152-26-000001", "ex99-1.htm", false));
    // Interrupted after the exhibits, before the primary. Must come back.
    await documents.put(documentRow("0001493152-26-000002", "ex99-1.htm", false));
    // Converted by an older converter. Must come back.
    await documents.put({
      ...documentRow("0001493152-26-000003", "form8k.htm", true),
      converter_version: "2",
    });

    const selected = await selectFilingsToConvert({
      forms: ["8-K"],
      limit: 10,
      converterVersion: VERSION,
    });

    expect(selected.map((f) => f.accession_number)).toEqual([
      "0001493152-26-000003",
      "0001493152-26-000002",
    ]);
  });

  it("returns every filing under --force, converted or not", async () => {
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const documents = globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN);
    await filings.put(filing("0001493152-26-000004") as never);
    await documents.put(documentRow("0001493152-26-000004", "form8k.htm", true));

    const selected = await selectFilingsToConvert({
      forms: ["8-K"],
      limit: 10,
      force: true,
      converterVersion: VERSION,
    });
    expect(selected.map((f) => f.accession_number)).toContain("0001493152-26-000004");
  });
});

/**
 * 8-K selection on the raw-SQL path.
 *
 * Worth its own SQLite coverage because SQLite numbers `?` by position and the
 * version placeholder sits inside the JOIN, ahead of every WHERE parameter — a
 * filter appended in the wrong order binds the version to a form name and
 * silently returns the wrong set, which reads as "nothing to convert".
 */
describe("selectFilingsToConvert 8-K (sqlite)", () => {
  const SPAC_CIK = 1811882;
  const OTHER_CIK = 320193;

  withSqliteDb("select_filings_to_convert_8k_sqlite_test", [
    FILING_REPOSITORY_TOKEN,
    FILING_DOCUMENT_REPOSITORY_TOKEN,
  ]);

  beforeEach(async () => {
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await filings.put({ ...filing("0001493152-26-000010"), cik: SPAC_CIK } as never);
    await filings.put({ ...filing("0001493152-26-000011"), cik: OTHER_CIK } as never);
  });

  it("selects every filer's 8-K", async () => {
    const selected = await selectFilingsToConvert({
      forms: ["8-K"],
      limit: 10,
      converterVersion: VERSION,
    });
    expect(selected.map((f) => f.accession_number).sort()).toEqual([
      "0001493152-26-000010",
      "0001493152-26-000011",
    ]);
  });

  it("narrows to one filer with --cik", async () => {
    const selected = await selectFilingsToConvert({
      forms: ["8-K"],
      cik: SPAC_CIK,
      limit: 10,
      converterVersion: VERSION,
    });
    expect(selected.map((f) => f.accession_number)).toEqual(["0001493152-26-000010"]);
  });

  it("binds the date floor to the right placeholder", async () => {
    expect(
      await selectFilingsToConvert({
        forms: ["8-K"],
        since: "2026-01-01",
        limit: 10,
        converterVersion: VERSION,
      })
    ).toHaveLength(2);
    expect(
      await selectFilingsToConvert({
        forms: ["8-K"],
        since: "2027-01-01",
        limit: 10,
        converterVersion: VERSION,
      })
    ).toHaveLength(0);
  });
});
