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
import { minimalSpac } from "../../config/testing/minimalSpac";
import { SPAC_REPOSITORY_TOKEN } from "../../storage/spac/SpacSchema";
import { registerSpacFilingConversionGate } from "../../storage/spac/spacFilingConversionGate";
import { clearFilingConversionGateForTesting } from "./filingConversionGate";
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

async function markConverted(
  accession: string,
  version: string,
  { docFile = "doc.htm", isPrimary = true }: { docFile?: string; isPrimary?: boolean } = {}
): Promise<void> {
  await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).put({
    cik: CIK,
    accession_number: accession,
    doc_file: docFile,
    doc_type: isPrimary ? "S-1" : "EX-99.1",
    description: null,
    sequence: isPrimary ? 1 : 2,
    is_primary: isPrimary,
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

describe("selectFilingsToConvert primary gate (repository path)", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await filings.setupDatabase();
    await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).setupDatabase();
    await filings.putBulk([filing("0001213900-26-000001", "S-1", "2026-02-01")]);
  });

  it("re-selects a filing whose exhibits landed but whose primary document did not", async () => {
    // The converter writes the primary LAST, so exhibit rows on their own mean
    // an interrupted run. "Has any row" would call this done and nothing would
    // ever come back for the document a reader actually opens.
    await markConverted("0001213900-26-000001", VERSION, {
      docFile: "ex99-1.htm",
      isPrimary: false,
    });
    const selected = await selectFilingsToConvert({ limit: 10, converterVersion: VERSION });
    expect(selected.map((f) => f.accession_number)).toContain("0001213900-26-000001");
  });

  it("skips it once the primary document is stored alongside them", async () => {
    await markConverted("0001213900-26-000001", VERSION, {
      docFile: "ex99-1.htm",
      isPrimary: false,
    });
    await markConverted("0001213900-26-000001", VERSION);
    const selected = await selectFilingsToConvert({ limit: 10, converterVersion: VERSION });
    expect(selected.map((f) => f.accession_number)).not.toContain("0001213900-26-000001");
  });
});

/**
 * 8-Ks are convertible only for known SPACs by default.
 *
 * Every reporting company files them on every earnings release, so the
 * unfiltered set dwarfs the rest of {@link CONVERTIBLE_FORMS} — a default sweep
 * that took them all would spend the whole budget converting filings this
 * product has no page for, and the lifecycle 8-Ks it does want would sit behind
 * them.
 */
describe("selectFilingsToConvert 8-K gate (repository path)", () => {
  const SPAC_CIK = 1811882;
  const OTHER_CIK = 320193;

  const eightK = (cik: number, accession: string) => ({
    ...filing(accession, "8-K", "2026-04-01"),
    cik,
  });

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await filings.setupDatabase();
    await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).setupDatabase();
    await globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN).setupDatabase();
    await filings.putBulk([
      eightK(SPAC_CIK, "0001213900-26-000010"),
      eightK(OTHER_CIK, "0001213900-26-000011"),
      // A registration is never gated: the whole point of the gate is that 8-Ks
      // are the form every filer files.
      { ...filing("0001213900-26-000012", "S-1", "2026-04-02"), cik: OTHER_CIK },
    ]);
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  const markSpac = async (cik: number, currentCik: number | null = null) => {
    await globalServiceRegistry
      .get(SPAC_REPOSITORY_TOKEN)
      .put(minimalSpac(cik, { current_cik: currentCik }));
  };

  const select = (over: Partial<Parameters<typeof selectFilingsToConvert>[0]> = {}) =>
    selectFilingsToConvert({ limit: 10, converterVersion: VERSION, ...over });

  it("takes a SPAC's 8-K and leaves everyone else's", async () => {
    await markSpac(SPAC_CIK);
    const rows = await select();
    expect(rows.map((r) => r.accession_number).sort()).toEqual([
      "0001213900-26-000010",
      "0001213900-26-000012",
    ]);
  });

  it("takes no 8-K at all when the spac table is empty", async () => {
    expect((await select()).map((r) => r.form)).toEqual(["S-1"]);
  });

  it("follows a de-SPAC to its surviving CIK", async () => {
    // The combination moved the reporting entity, and the closing 8-K is filed
    // under the new CIK. Keying only on the origin CIK would drop exactly the
    // filing the lifecycle is built from.
    await markSpac(SPAC_CIK, OTHER_CIK);
    const rows = await select({ forms: ["8-K"] });
    expect(rows.map((r) => r.accession_number).sort()).toEqual([
      "0001213900-26-000010",
      "0001213900-26-000011",
    ]);
  });

  it("takes every filer's 8-K under all8k", async () => {
    const rows = await select({ forms: ["8-K"], all8k: true });
    expect(rows).toHaveLength(2);
  });

  it("gates an explicit --types 8-K too, so the narrowing is not also a widening", async () => {
    await markSpac(SPAC_CIK);
    const rows = await select({ forms: ["8-K", "8-K/A"] });
    expect(rows.map((r) => r.accession_number)).toEqual(["0001213900-26-000010"]);
  });
});

/**
 * The gate is contributed, not built in — and an absent one closes.
 *
 * The filer set comes from a lifecycle model that need not ship in the same
 * package as the sweep, so the sweep has to behave when nothing registered one.
 * Falling OPEN there would convert every 8-K of every filer, which is the one
 * outcome the gate exists to prevent, and it would do it silently on a
 * deployment that never asked for a single 8-K.
 */
describe("selectFilingsToConvert 8-K gate seam (repository path)", () => {
  const SPAC_CIK = 1811882;
  const OTHER_CIK = 320193;

  const eightK = (cik: number, accession: string) => ({
    ...filing(accession, "8-K", "2026-04-01"),
    cik,
  });

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    const filings = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    await filings.setupDatabase();
    await globalServiceRegistry.get(FILING_DOCUMENT_REPOSITORY_TOKEN).setupDatabase();
    await globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN).setupDatabase();
    await filings.putBulk([
      eightK(SPAC_CIK, "0001213900-26-000010"),
      eightK(OTHER_CIK, "0001213900-26-000011"),
      { ...filing("0001213900-26-000012", "S-1", "2026-04-02"), cik: OTHER_CIK },
    ]);
    // A spac row IS present: what changes the answer below is the missing
    // registration, not a missing filer.
    await globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN).put(minimalSpac(SPAC_CIK));
    clearFilingConversionGateForTesting();
  });

  afterEach(() => {
    registerSpacFilingConversionGate();
    resetDependencyInjectionsForTesting();
  });

  const select = (over: Partial<Parameters<typeof selectFilingsToConvert>[0]> = {}) =>
    selectFilingsToConvert({ limit: 10, converterVersion: VERSION, ...over });

  it("converts no 8-K at all with no gate registered, and leaves every other form alone", async () => {
    expect((await select()).map((r) => r.accession_number)).toEqual(["0001213900-26-000012"]);
    expect(await select({ forms: ["8-K", "8-K/A"] })).toEqual([]);
  });

  it("takes the admitted filer's 8-K again once a gate is registered", async () => {
    registerSpacFilingConversionGate();
    expect((await select({ forms: ["8-K"] })).map((r) => r.accession_number)).toEqual([
      "0001213900-26-000010",
    ]);
  });

  it("still converts everyone's 8-K under all8k, which asks for them explicitly", async () => {
    const rows = await select({ forms: ["8-K"], all8k: true });
    expect(rows.map((r) => r.accession_number).sort()).toEqual([
      "0001213900-26-000010",
      "0001213900-26-000011",
    ]);
  });
});
