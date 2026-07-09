/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { processForm424 } from "./Form_424.storage";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const CIK = 2114227;
const S1_ACCESSION = "0000000000-26-000901";
const B4_ACCESSION = "0000000000-26-000902";

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

const SPAC_S1_HEADER = {
  sic: 6770,
  sicDescription: "BLANK CHECKS",
  cik: CIK,
  companyName: "Synthetic SPAC Corp",
  filingDate: null,
};

const SPAC_424_HEADER = {
  sic: 6770,
  sicDescription: "BLANK CHECKS",
  cik: CIK,
  companyName: "Synthetic SPAC Corp",
  filingDate: "20260428",
};

// Minimal S-1 HTML body with the three entity sections so the segmenter succeeds.
const S1_HTML = [
  "<h1>MANAGEMENT</h1><p>Jane Roe — Director</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1><p>None.</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1><p>None.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

// 424B4 HTML with offering + underwriting sections that the fake model will respond to.
const OFFERING_HTML = [
  "<h1>THE OFFERING</h1><p>We are offering 30,000,000 units at $10.00.</p>",
  "<h1>UNDERWRITING</h1><p>BTIG, LLC is the book-running manager.</p>",
].join("");

let cleanup: (() => void) | undefined;

describe("processFormS1 + processForm424 → SPAC report", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("registration then priced 424B4 produces an ipo-status row with tickers", async () => {
    // S-1 pass: no entity sections yield rows (empty fake responses).
    const s1Reg = registerFakeStructuredProvider([{ people: [] }, { owners: [] }, { parties: [] }]);
    await processFormS1({
      cik: CIK,
      file_number: "333-000002",
      accession_number: S1_ACCESSION,
      filing_date: "2026-04-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: SPAC_S1_HEADER,
        html: S1_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });
    s1Reg.unregister();

    // 424B4 pass: the offering-terms model call returns SPAC unit terms with tickers.
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: "Units",
        shares_offered: null,
        price: null,
        price_low: null,
        price_high: null,
        gross_proceeds: 300000000,
        net_proceeds: null,
        over_allotment_shares: null,
        units_offered: 30000000,
        price_per_unit: 10,
        unit_composition: "one share and one-quarter warrant",
        warrant_fraction_per_unit: 0.25,
        right_fraction_per_unit: null,
        trust_per_unit: 10.0,
        over_allotment_units: 4500000,
        exchange: "NASDAQ",
        par_value: null,
        confidence: 0.9,
        source_span: "30,000,000 units",
        tickers: [
          { ticker: "CCXII.U", exchange: "NASDAQ", security_type: "Units", is_primary: false },
          { ticker: "CCXII", exchange: "NASDAQ", security_type: "Common", is_primary: true },
          { ticker: "CCXII.WS", exchange: "NASDAQ", security_type: "Warrants", is_primary: false },
        ],
      },
      { underwriters: [] },
    ]);
    cleanup = unregister;

    await processForm424({
      cik: CIK,
      file_number: "333-000002",
      accession_number: B4_ACCESSION,
      filing_date: "2026-04-28",
      primary_doc: "424b4.htm",
      form: "424B4",
      form424: {
        header: SPAC_424_HEADER,
        html: OFFERING_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const row = await new SpacRepo().getSpac(CIK);
    expect(row?.status).toBe("ipo");
    expect(row?.ipo_date).toBe("2026-04-28");
    // spac_tickers is stored as a JSON string (per SpacSchema); the history()
    // sort puts the primary ticker first, then alphabetical: CCXII, CCXII.U, CCXII.WS.
    // All three SPAC-era tickers (common + units + warrants) must be present.
    const tickers = row?.spac_tickers != null ? (JSON.parse(row.spac_tickers) as string[]) : null;
    expect(tickers).toEqual(["CCXII", "CCXII.U", "CCXII.WS"]);
  });

  it("a non-SPAC priced 424B4 does not create a spac row", async () => {
    // No S-1 registration first; process a 424B4 with a non-SPAC (null) header.
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: "Common Stock",
        shares_offered: 5000000,
        price: 15.0,
        price_low: null,
        price_high: null,
        gross_proceeds: 75000000,
        net_proceeds: null,
        over_allotment_shares: null,
        units_offered: null,
        price_per_unit: null,
        unit_composition: null,
        warrant_fraction_per_unit: null,
        right_fraction_per_unit: null,
        trust_per_unit: null,
        over_allotment_units: null,
        exchange: "NYSE",
        par_value: 0.001,
        confidence: 0.9,
        source_span: "5,000,000 shares",
        tickers: [
          { ticker: "ACME", exchange: "NYSE", security_type: "Common Stock", is_primary: true },
        ],
      },
      { underwriters: [] },
    ]);
    cleanup = unregister;

    const NON_SPAC_CIK = 9999001;
    await processForm424({
      cik: NON_SPAC_CIK,
      file_number: "333-999001",
      accession_number: "0000000000-26-009901",
      filing_date: "2026-04-28",
      primary_doc: "424b4.htm",
      form: "424B4",
      form424: {
        header: NULL_HEADER,
        html: [
          "<h1>THE OFFERING</h1><p>We are offering 5,000,000 shares at $15.00.</p>",
          "<h1>UNDERWRITING</h1><p>Goldman Sachs is the underwriter.</p>",
        ].join(""),
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const row = await new SpacRepo().getSpac(NON_SPAC_CIK);
    expect(row).toBeUndefined();
  });
});
