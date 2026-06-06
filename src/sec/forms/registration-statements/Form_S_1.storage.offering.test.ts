/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { processFormS1 } from "./Form_S_1.storage";
import { OfferingTermsRepo } from "../../../storage/offering/OfferingTermsRepo";
import { SpacUnitTermsRepo } from "../../../storage/offering/SpacUnitTermsRepo";
import { IssuerTickerRepo } from "../../../storage/offering/IssuerTickerRepo";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const OFFERING_HTML = [
  "<h1>THE OFFERING</h1><p>We are offering 5,000,000 shares.</p>",
  "<h1>UNDERWRITING</h1><p>Goldman Sachs &amp; Co. LLC is the representative.</p>",
].join("");

const SPAC_HEADER = {
  sic: 6770,
  sicDescription: "BLANK CHECKS",
  cik: 1848507,
  companyName: "Acme Acquisition Corp",
  filingDate: "20260102",
};
const NULL_HEADER = { sic: null, sicDescription: null, cik: null, companyName: null, filingDate: null };

let cleanup: (() => void) | undefined;

describe("processFormS1 offering terms", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("writes equity offering terms + tickers for a non-SPAC filing", async () => {
    // Sections present: The Offering + Underwriting -> offering-terms (1st call),
    // then underwriters (2nd call). Use-of-proceeds absent. Sponsors gated off.
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: "Common Stock",
        shares_offered: 5000000,
        price: null,
        price_low: 14,
        price_high: 16,
        gross_proceeds: 75000000,
        net_proceeds: 69000000,
        over_allotment_shares: 750000,
        units_offered: null,
        price_per_unit: null,
        unit_composition: null,
        warrant_fraction_per_unit: null,
        right_fraction_per_unit: null,
        trust_per_unit: null,
        over_allotment_units: null,
        exchange: "NASDAQ",
        par_value: 0.0001,
        confidence: 0.9,
        source_span: "5,000,000 shares",
        tickers: [{ ticker: "ACME", exchange: "NASDAQ", security_type: "Common Stock", is_primary: true }],
      },
      { underwriters: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "0000000000-26-000001",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: OFFERING_HTML },
      model: fakeS1Model(),
    });

    const terms = await new OfferingTermsRepo().get("S-1", "0000000000-26-000001");
    expect(terms?.price_high).toBe(16);
    expect(terms?.ticker).toBe("ACME");
    const history = await new IssuerTickerRepo().history(1018724);
    expect(history.map((t) => t.ticker)).toEqual(["ACME"]);
  });

  it("writes SPAC unit terms + multiple tickers for a SPAC filing", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: "Units",
        shares_offered: null,
        price: null,
        price_low: null,
        price_high: null,
        gross_proceeds: 200000000,
        net_proceeds: null,
        over_allotment_shares: null,
        units_offered: 20000000,
        price_per_unit: 10,
        unit_composition: "one share and one-half warrant",
        warrant_fraction_per_unit: 0.5,
        right_fraction_per_unit: null,
        trust_per_unit: 10.1,
        over_allotment_units: 3000000,
        exchange: "NASDAQ",
        par_value: null,
        confidence: 0.9,
        source_span: "each unit",
        tickers: [
          { ticker: "ACQU", exchange: "NASDAQ", security_type: "Units", is_primary: true },
          { ticker: "ACQ", exchange: "NASDAQ", security_type: "Class A", is_primary: false },
          { ticker: "ACQW", exchange: "NASDAQ", security_type: "Warrants", is_primary: false },
        ],
      },
      { underwriters: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1848507,
      file_number: "333-2",
      accession_number: "0000000000-26-000002",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: SPAC_HEADER, html: OFFERING_HTML },
      model: fakeS1Model(),
    });

    const unit = await new SpacUnitTermsRepo().get("S-1", "0000000000-26-000002");
    expect(unit?.warrant_fraction_per_unit).toBe(0.5);
    expect(unit?.trust_per_unit).toBe(10.1);
    expect(await new OfferingTermsRepo().get("S-1", "0000000000-26-000002")).toBeUndefined();
    const history = await new IssuerTickerRepo().history(1848507);
    expect(history.map((t) => t.ticker).sort()).toEqual(["ACQ", "ACQU", "ACQW"]);
  });
});
