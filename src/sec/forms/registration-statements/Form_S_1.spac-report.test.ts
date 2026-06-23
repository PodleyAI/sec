/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { processFormS1 } from "./Form_S_1.storage";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const SPAC_CIK = 1821595;
const NON_SPAC_CIK = 1018724;

const SPAC_HEADER = {
  sic: 6770,
  sicDescription: "BLANK CHECKS",
  cik: SPAC_CIK,
  companyName: "Test SPAC Corp",
  filingDate: null,
};

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

// Minimal HTML body — enough for the segmenter to parse without throwing.
const MINIMAL_HTML = [
  "<h1>MANAGEMENT</h1><p>Jane Roe — Director</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1><p>None.</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1><p>None.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

let cleanup: (() => void) | undefined;

describe("processFormS1 → SPAC report", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("creates a registered SPAC row when the S-1 header has SIC 6770", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    const FILING_DATE = "2020-12-21";
    await processFormS1({
      cik: SPAC_CIK,
      file_number: "333-1",
      accession_number: "0000000000-20-000001",
      filing_date: FILING_DATE,
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: SPAC_HEADER, html: MINIMAL_HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const row = await new SpacRepo().getSpac(SPAC_CIK);
    expect(row?.status).toBe("registered");
    expect(row?.spac_sic).toBe(6770);
    expect(row?.registration_date).toBe(FILING_DATE);
    expect(row?.spac_name).not.toBeNull();
  });

  it("creates no spac row when the S-1 has a non-SPAC (null SIC) header", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: NON_SPAC_CIK,
      file_number: "333-2",
      accession_number: "0000000000-26-000001",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: MINIMAL_HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const row = await new SpacRepo().getSpac(NON_SPAC_CIK);
    expect(row).toBeUndefined();
  });
});
