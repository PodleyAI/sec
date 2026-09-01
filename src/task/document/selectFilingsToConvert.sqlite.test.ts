/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../../config/testing/withSqliteDb";
import { FILING_DOCUMENT_REPOSITORY_TOKEN } from "../../storage/document/FilingDocumentSchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import {
  clearFilingConversionGateForTesting,
  registerFilingConversionGate,
  type GateSqlFragment,
  type GateSqlRequest,
} from "./filingConversionGate";
import { selectFilingsToConvert } from "./selectFilingsToConvert";

/**
 * A gate that pushes down, over a table this package owns.
 *
 * The filer set is a lifecycle model's, and that model ships elsewhere — so
 * what belongs here is the sweep's half of the pushdown contract: a fragment
 * spliced into the statement, correlated against the filing row, over a storage
 * `resolveSqlBackend` finds durable. `entities` is the stand-in because it is
 * CIK-keyed and this package creates it; which CIKs a real gate puts in such a
 * table is that package's rule and that package's test.
 */
function entityExistsFragment({ backend, filingAlias }: GateSqlRequest): GateSqlFragment {
  const q = backend === "sqlite" ? (id: string) => `\`${id}\`` : (id: string) => `"${id}"`;
  return {
    sql:
      `EXISTS (SELECT 1 FROM ${q("entities")} e ` +
      `WHERE e.${q("cik")} = ${filingAlias}.${q("cik")})`,
    params: [],
  };
}

/** Registers that gate against the live `entities` binding. */
function registerEntityGate(): void {
  const entities = globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN);
  registerFilingConversionGate({
    admittedCiks: async () => {
      const ciks = new Set<number>();
      for await (const row of entities.records(1000)) ciks.add(Number(row.cik));
      return ciks;
    },
    pushdown: () => ({ storage: entities, fragment: entityExistsFragment }),
  });
}

/**
 * An `entities` row, which is what the gate above admits a filer by.
 *
 * Every nullable column is named: `TypeNullable` means "may hold null", not
 * "may be absent", and the storage rejects a missing key on one.
 */
async function admitCik(cik: number): Promise<void> {
  await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).put({
    cik,
    name: null,
    type: null,
    sic: null,
    ein: null,
    description: null,
    website: null,
    investor_website: null,
    category: null,
    fiscal_year: null,
    state_incorporation: null,
    state_incorporation_desc: null,
  });
}

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
  // `entities` is in the wiring because the 8-K fixtures below are gated on the
  // gate registered against it: `DefaultDI` binds every token whether or not
  // the table was created, so a sweep that reaches the gate needs the real
  // table, not just the binding.
  withSqliteDb("select_filings_to_convert_sqlite_test", [
    FILING_REPOSITORY_TOKEN,
    FILING_DOCUMENT_REPOSITORY_TOKEN,
    ENTITY_REPOSITORY_TOKEN,
  ]);

  beforeEach(async () => {
    registerEntityGate();
    await admitCik(CIK);
  });

  afterEach(() => {
    clearFilingConversionGateForTesting();
  });

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
 * The 8-K gate on the raw-SQL path.
 *
 * Worth its own SQLite coverage because the predicate is a correlated EXISTS
 * hand-written per backend, and SQLite numbers `?` by position — a gated form
 * appended in the wrong order binds the version placeholder to a form name and
 * silently returns the wrong set, which reads as "nothing to convert".
 */
describe("selectFilingsToConvert 8-K gate (sqlite)", () => {
  const ADMITTED_CIK = 1811882;
  const OTHER_CIK = 320193;

  withSqliteDb("select_filings_to_convert_gate_sqlite_test", [
    FILING_REPOSITORY_TOKEN,
    FILING_DOCUMENT_REPOSITORY_TOKEN,
    ENTITY_REPOSITORY_TOKEN,
  ]);

  beforeEach(async () => {
    registerEntityGate();
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await filings.put({ ...filing("0001493152-26-000010"), cik: ADMITTED_CIK } as never);
    await filings.put({ ...filing("0001493152-26-000011"), cik: OTHER_CIK } as never);
  });

  afterEach(() => {
    clearFilingConversionGateForTesting();
  });

  it("keeps an admitted filer's 8-K and drops the rest", async () => {
    await admitCik(ADMITTED_CIK);
    const selected = await selectFilingsToConvert({
      forms: ["8-K"],
      limit: 10,
      converterVersion: VERSION,
    });
    expect(selected.map((f) => f.accession_number)).toEqual(["0001493152-26-000010"]);
  });

  it("keeps both once the gate admits both filers", async () => {
    await admitCik(ADMITTED_CIK);
    await admitCik(OTHER_CIK);
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

  it("keeps every filer's 8-K under all8k, with the date filter still applied", async () => {
    // `all8k` drops the gate clause, which is also what shifts every later
    // placeholder — so a filter that still binds correctly is the real check.
    const selected = await selectFilingsToConvert({
      forms: ["8-K"],
      since: "2026-01-01",
      limit: 10,
      all8k: true,
      converterVersion: VERSION,
    });
    expect(selected).toHaveLength(2);
    expect(
      await selectFilingsToConvert({
        forms: ["8-K"],
        since: "2027-01-01",
        limit: 10,
        all8k: true,
        converterVersion: VERSION,
      })
    ).toHaveLength(0);
  });
});

/**
 * The gate seam on the raw-SQL path.
 *
 * The pushed-down half is where an unregistered gate would fall open most
 * quietly: dropping the clause from the query leaves a statement that still
 * runs, still binds, and returns every 8-K in the table. So the clause has to
 * survive the gate's absence as a plain form exclusion — and the placeholder
 * numbering has to survive it too, which is what the date floor here checks.
 */
describe("selectFilingsToConvert 8-K gate seam (sqlite)", () => {
  const ADMITTED_CIK = 1811882;
  const OTHER_CIK = 320193;

  withSqliteDb("select_filings_to_convert_gate_seam_sqlite_test", [
    FILING_REPOSITORY_TOKEN,
    FILING_DOCUMENT_REPOSITORY_TOKEN,
    ENTITY_REPOSITORY_TOKEN,
  ]);

  beforeEach(async () => {
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await filings.put({ ...filing("0001493152-26-000010"), cik: ADMITTED_CIK } as never);
    await filings.put({ ...filing("0001493152-26-000011"), cik: OTHER_CIK } as never);
    await filings.put({
      ...filing("0001493152-26-000012"),
      cik: OTHER_CIK,
      form: "S-1",
    } as never);
    // The filer the gate WOULD admit is present: what changes the answer below
    // is the missing registration, not a missing filer.
    await admitCik(ADMITTED_CIK);
    clearFilingConversionGateForTesting();
  });

  afterEach(() => {
    clearFilingConversionGateForTesting();
  });

  it("selects no 8-K with no gate registered, and still selects the ungated forms", async () => {
    expect(
      await selectFilingsToConvert({
        forms: ["8-K", "8-K/A"],
        limit: 10,
        converterVersion: VERSION,
      })
    ).toEqual([]);
    const mixed = await selectFilingsToConvert({
      forms: ["8-K", "S-1"],
      since: "2026-01-01",
      limit: 10,
      converterVersion: VERSION,
    });
    expect(mixed.map((f) => f.accession_number)).toEqual(["0001493152-26-000012"]);
  });

  it("selects the admitted filer's 8-K again once a gate is registered", async () => {
    registerEntityGate();
    const selected = await selectFilingsToConvert({
      forms: ["8-K"],
      limit: 10,
      converterVersion: VERSION,
    });
    expect(selected.map((f) => f.accession_number)).toEqual(["0001493152-26-000010"]);
  });

  it("still selects every filer's 8-K under all8k with no gate registered", async () => {
    const selected = await selectFilingsToConvert({
      forms: ["8-K"],
      since: "2026-01-01",
      limit: 10,
      all8k: true,
      converterVersion: VERSION,
    });
    expect(selected.map((f) => f.accession_number).sort()).toEqual([
      "0001493152-26-000010",
      "0001493152-26-000011",
    ]);
  });
});
