/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { selectFilingsToConvert } from "./selectFilingsToConvert";

const VERSION = "3";

const filing = (accession: string) => ({
  cik: 1083743,
  accession_number: accession,
  filing_date: "2026-03-01",
  acceptance_date: "2026-03-01T12:00:00.000Z",
  form: "8-K",
  primary_doc: "form8k.htm",
});

const documentRow = (accession: string, docFile: string, isPrimary: boolean) => ({
  cik: 1083743,
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
