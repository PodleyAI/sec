/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import type { Filing } from "../../storage/filing/FilingSchema";
import { SPAC_REPOSITORY_TOKEN, SpacSchema } from "../../storage/spac/SpacSchema";
import {
  accessionScopedStorages,
  clearWebExtractionTablesForTesting,
  registerWebExtractionTables,
} from "./extractions";
import { resolveBodyFileName } from "./documents";

function filing(overrides: Partial<Filing>): Filing {
  return {
    cik: 1,
    accession_number: "0000000000-25-000001",
    filing_date: "2025-01-01",
    report_date: null,
    acceptance_date: "2025-01-01T12:00:00.000Z",
    form: "8-K",
    file_number: null,
    film_number: null,
    primary_doc: "doc.htm",
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
    ...overrides,
  } as Filing;
}

async function addSpacRow(cik: number): Promise<void> {
  const row: Record<string, unknown> = {};
  for (const name of Object.keys(SpacSchema.properties as Record<string, unknown>))
    row[name] = null;
  await globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN).put({
    ...row,
    cik,
    status: "registered",
    updated_at: "2026-08-01T00:00:00.000Z",
  } as never);
}

describe("resolveBodyFileName", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("reads a registration statement as the full submission, not its primary document", async () => {
    // An S-1's primary document is a cover page; the extractor parses the whole
    // submission. A viewer that opened the primary document would report every
    // section as missing on a filing that extracted perfectly well.
    const name = await resolveBodyFileName(filing({ form: "S-1" }));
    expect(name).toBe("0000000000-25-000001.txt");
  });

  it("keeps an ordinary 8-K on its primary document", async () => {
    expect(await resolveBodyFileName(filing({ form: "8-K", items: "5.02" }))).toBe("doc.htm");
  });

  it("escalates a known SPAC's trigger 8-K to the full submission", async () => {
    await addSpacRow(1);
    // The redemption / LOI passes read the EX-99 exhibits, which only the full
    // submission carries.
    expect(await resolveBodyFileName(filing({ form: "8-K", items: "5.07" }))).toBe(
      "0000000000-25-000001.txt"
    );
  });

  it("leaves a trigger 8-K alone when the issuer is not a known SPAC", async () => {
    expect(await resolveBodyFileName(filing({ form: "8-K", items: "5.07" }))).toBe("doc.htm");
  });

  it("strips EDGAR's inline-XBRL viewer prefix from an ownership form", async () => {
    expect(
      await resolveBodyFileName(filing({ form: "4", primary_doc: "xslF345X03/wf-form4.xml" }))
    ).toBe("wf-form4.xml");
  });

  it("returns undefined for a filing that names no primary document", async () => {
    expect(await resolveBodyFileName(filing({ form: "4", primary_doc: "" }))).toBeUndefined();
  });
});

describe("accessionScopedStorages", () => {
  beforeEach(() => {
    clearWebExtractionTablesForTesting();
  });

  it("derives the searched tables from the storage registry", () => {
    const tables = accessionScopedStorages().map((d) => d.table);
    // Derived rather than listed, so a newly registered extraction table shows
    // up in the viewer without anyone remembering to add it here.
    expect(tables).toContain("xbrl_fact");
    expect(tables).toContain("beneficial_ownership");
    expect(tables).toContain("spac_unit_terms");
    // A table with no accession column has nothing to show for one filing.
    expect(tables).not.toContain("entities");
    expect(tables).not.toContain("spac_candidate");
  });

  it("includes a superset's registered tables, and ignores ones with no accession column", () => {
    // Without this seam an `embarc-data` filing page would show every sec row
    // for an accession and silently omit the superset's own — the shape most
    // likely to be read as "that extractor wrote nothing".
    registerWebExtractionTables([
      {
        token: { id: "test.withAccession" } as never,
        table: "downstream_with_accession",
        schema: {
          type: "object",
          properties: { accession_number: { type: "string" }, value: { type: "string" } },
        } as never,
      },
      {
        token: { id: "test.withoutAccession" } as never,
        table: "downstream_without_accession",
        schema: { type: "object", properties: { cik: { type: "number" } } } as never,
      },
    ]);
    const tables = accessionScopedStorages().map((d) => d.table);
    expect(tables).toContain("downstream_with_accession");
    expect(tables).not.toContain("downstream_without_accession");
  });

  it("refuses to shadow a table sec owns", () => {
    expect(() =>
      registerWebExtractionTables([
        {
          token: { id: "x" } as never,
          table: "xbrl_fact",
          schema: { type: "object", properties: {} } as never,
        },
      ])
    ).toThrow(/already owned by sec/);
  });
});
