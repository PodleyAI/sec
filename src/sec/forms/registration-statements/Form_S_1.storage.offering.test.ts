/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { IssuerTickerRepo } from "../../../storage/offering/IssuerTickerRepo";
import { OfferingTermsRepo } from "../../../storage/offering/OfferingTermsRepo";
import { SpacUnitTermsRepo } from "../../../storage/offering/SpacUnitTermsRepo";
import { SpacPromoteTermsRepo } from "../../../storage/offering/SpacPromoteTermsRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FieldProvenanceRepo } from "../../../storage/provenance/FieldProvenanceRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { UnderwriterLinkRepo } from "../../../storage/canonical/UnderwriterLinkRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { DETERMINISTIC_MODEL_ID } from "./s1/parseOfferingTables";
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
const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

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
        tickers: [
          { ticker: "ACME", exchange: "NASDAQ", security_type: "Common Stock", is_primary: true },
        ],
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
      formS1: {
        header: NULL_HEADER,
        html: OFFERING_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
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
        // Substring of the offering-terms section text (verifyRow gate).
        source_span: "5,000,000 shares",
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
      formS1: {
        header: SPAC_HEADER,
        html: OFFERING_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const unit = await new SpacUnitTermsRepo().get("S-1", "0000000000-26-000002");
    expect(unit?.warrant_fraction_per_unit).toBe(0.5);
    expect(unit?.trust_per_unit).toBe(10.1);
    expect(await new OfferingTermsRepo().get("S-1", "0000000000-26-000002")).toBeUndefined();
    const history = await new IssuerTickerRepo().history(1848507);
    expect(history.map((t) => t.ticker).sort()).toEqual(["ACQ", "ACQU", "ACQW"]);
  });

  it("writes sponsor promote terms for a SPAC filing", async () => {
    // Call order inside a SPAC S-1 with only The Offering + Underwriting present:
    // offering-terms (1), sponsor-promote (2), underwriters (3). Use-of-proceeds
    // and the profile/sponsor sections are absent (SECTION_NOT_FOUND, no call).
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: "Units",
        units_offered: 20000000,
        price_per_unit: 10,
        confidence: 0.9,
        source_span: "5,000,000 shares",
        tickers: [{ ticker: "ACQU", exchange: "NASDAQ", security_type: "Units", is_primary: true }],
      },
      {
        founder_shares: 5000000,
        founder_percent: 0.2,
        private_placement_warrants: 10000000,
        private_placement_warrant_price: 1.0,
        public_warrant_coverage: 0.5,
        trust_per_public_share: 10.0,
        trust_total: 200000000,
        confidence: 0.9,
        source_span: "5,000,000 shares",
      },
      { underwriters: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1848507,
      file_number: "333-3",
      accession_number: "0000000000-26-000003",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: SPAC_HEADER,
        html: OFFERING_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const promote = await new SpacPromoteTermsRepo().get("S-1", "0000000000-26-000003");
    expect(promote?.founder_shares).toBe(5000000);
    expect(promote?.founder_percent).toBe(0.2);
    expect(promote?.private_placement_warrants).toBe(10000000);
    expect(promote?.public_warrant_coverage).toBe(0.5);
    expect(promote?.trust_per_public_share).toBe(10.0);
    expect(promote?.trust_total).toBe(200000000);
  });

  it("persists SPAC unit + promote terms when the model span is a paraphrase but the figures appear in the section", async () => {
    // SilverBox IV / ITHAX III: the model returns one offering-terms object
    // and one promote object, then classifySpan drops both because the
    // source_span is a paraphrase. The unit counts and trust figures are
    // still in the section text.
    const html = [
      "<h1>THE OFFERING</h1>",
      "<p>We are offering 20,000,000 units at $10.00 per unit.",
      "Founder shares 5,000,000. $10.00 per public share is deposited in trust,",
      "for a total of $200,000,000.</p>",
      "<h1>UNDERWRITING</h1><p>Goldman Sachs &amp; Co. LLC is the representative.</p>",
    ].join("");
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
        trust_per_unit: 10,
        over_allotment_units: null,
        exchange: "NASDAQ",
        par_value: null,
        confidence: 0.9,
        source_span: "a paraphrase the section does not contain",
        tickers: [{ ticker: "ACQU", exchange: "NASDAQ", security_type: "Units", is_primary: true }],
      },
      {
        founder_shares: 5000000,
        founder_percent: 0.2,
        private_placement_warrants: 10000000,
        private_placement_warrant_price: 1.0,
        public_warrant_coverage: 0.5,
        trust_per_public_share: 10.0,
        trust_total: 200000000,
        confidence: 0.9,
        source_span: "a paraphrase the section does not contain",
      },
      { underwriters: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1848507,
      file_number: "333-5",
      accession_number: "0000000000-26-000005",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: SPAC_HEADER,
        html,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const unit = await new SpacUnitTermsRepo().get("S-1", "0000000000-26-000005");
    expect(unit?.units_offered).toBe(20000000);
    expect(unit?.price_per_unit).toBe(10);
    const promote = await new SpacPromoteTermsRepo().get("S-1", "0000000000-26-000005");
    expect(promote?.trust_total).toBe(200000000);
    expect(promote?.founder_shares).toBe(5000000);
  });

  it("skips promote for a non-SPAC filing", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: "Common Stock",
        confidence: 0.9,
        source_span: "5,000,000 shares",
        tickers: [],
      },
      { underwriters: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-4",
      accession_number: "0000000000-26-000004",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: OFFERING_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    expect(await new SpacPromoteTermsRepo().get("S-1", "0000000000-26-000004")).toBeUndefined();
  });

  it("says so in the dead letter when a failed offering-terms span also costs the tickers", async () => {
    // The section returns ONE object carrying the unit terms AND the whole
    // ticker array under a single source_span, so a failed span drops all of
    // them. A live run dead-lettered here and silently recorded no tickers at
    // all — the detail has to name what went with it.
    const bad = {
      security_type: "Units",
      shares_offered: null,
      price: null,
      price_low: null,
      price_high: null,
      gross_proceeds: null,
      net_proceeds: null,
      over_allotment_shares: null,
      units_offered: 20000000,
      price_per_unit: 10,
      unit_composition: null,
      warrant_fraction_per_unit: null,
      right_fraction_per_unit: null,
      trust_per_unit: null,
      over_allotment_units: null,
      exchange: "NASDAQ",
      par_value: null,
      confidence: 0.9,
      source_span: "a span that is nowhere in the section text",
      tickers: [{ ticker: "ACQU", exchange: "NASDAQ", security_type: "Units", is_primary: true }],
    };
    const { unregister } = registerFakeStructuredProvider([bad, bad, bad, { underwriters: [] }]);
    cleanup = unregister;

    await processFormS1({
      cik: 1848599,
      file_number: "333-9",
      accession_number: "0000000000-26-000009",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: SPAC_HEADER,
        html: OFFERING_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    expect(await new SpacUnitTermsRepo().get("S-1", "0000000000-26-000009")).toBeUndefined();
    expect(await new IssuerTickerRepo().history(1848599)).toEqual([]);
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    const offering = dl.find((d) => d.section_name === "offering-terms");
    expect(offering?.detail).toMatch(/NO issuer ticker rows/);
  });

  it("persists a markdown-table hit as deterministic without calling the offering model", async () => {
    const html = [
      "<h1>THE OFFERING</h1>",
      "<table>",
      "<tr><td>Offering price</td><td>$10.00</td></tr>",
      "<tr><td>Number of units offered</td><td>20,000,000</td></tr>",
      "<tr><td>Founder shares</td><td>5,750,000</td></tr>",
      "<tr><td>Proceeds to be held in trust account</td><td>$10.00 per unit</td></tr>",
      "</table>",
      "<h1>UNDERWRITING</h1><p>Goldman Sachs &amp; Co. LLC is the representative.</p>",
    ].join("");
    const { unregister } = registerFakeStructuredProvider([{ underwriters: [] }]);
    cleanup = unregister;

    await processFormS1({
      cik: 1848507,
      file_number: "333-10",
      accession_number: "0000000000-26-000010",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: SPAC_HEADER,
        html,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const unit = await new SpacUnitTermsRepo().get("S-1", "0000000000-26-000010");
    expect(unit?.price_per_unit).toBe(10);
    expect(unit?.units_offered).toBe(20_000_000);
    const promote = await new SpacPromoteTermsRepo().get("S-1", "0000000000-26-000010");
    expect(promote?.founder_shares).toBe(5_750_000);
    expect(promote?.trust_per_public_share).toBe(10);
    const prov = await new FieldProvenanceRepo().listByAccession("0000000000-26-000010");
    const unitProv = prov.filter((p) => p.table_name === "spac_unit_terms");
    const promoteProv = prov.filter((p) => p.table_name === "spac_promote_terms");
    expect(unitProv.length).toBeGreaterThan(0);
    expect(unitProv.every((p) => p.model_id === DETERMINISTIC_MODEL_ID)).toBe(true);
    expect(promoteProv.length).toBeGreaterThan(0);
    expect(promoteProv.every((p) => p.model_id === DETERMINISTIC_MODEL_ID)).toBe(true);
  });

  it("persists a syndicate table hit as deterministic without calling the underwriters model", async () => {
    const html = [
      "<h1>THE OFFERING</h1>",
      "<table>",
      "<tr><td>Offering price</td><td>$10.00</td></tr>",
      "<tr><td>Number of units offered</td><td>20,000,000</td></tr>",
      "<tr><td>Founder shares</td><td>5,750,000</td></tr>",
      "<tr><td>Proceeds to be held in trust account</td><td>$10.00 per unit</td></tr>",
      "</table>",
      "<h1>UNDERWRITING</h1>",
      "<table>",
      "<tr><td>Underwriter</td><td>Number of Units</td></tr>",
      "<tr><td>Cantor Fitzgerald &amp; Co.</td><td></td></tr>",
      "<tr><td>Total</td><td>20,000,000</td></tr>",
      "</table>",
    ].join("");
    const { unregister } = registerFakeStructuredProvider([]);
    cleanup = unregister;

    await processFormS1({
      cik: 1848507,
      file_number: "333-11",
      accession_number: "0000000000-26-000011",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: SPAC_HEADER,
        html,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const obs = await new CompanyObservationRepo().listByAccession("0000000000-26-000011");
    expect(obs.map((o) => o.name).filter((n) => n != null && n !== "")).toEqual([
      "Cantor Fitzgerald & Co.",
    ]);
    const links = await new UnderwriterLinkRepo().listByAccession("0000000000-26-000011");
    expect(links).toHaveLength(1);
    expect(links[0]!.role_detail).toBeNull();
  });

  it("skips the underwriters model on a SPAC resale with no unit IPO", async () => {
    const html = [
      "<h1>THE OFFERING</h1><p>We are offering 5,000,000 shares.</p>",
      "<h1>UNDERWRITING</h1>",
      "<table>",
      "<tr><td>Selling Stockholder</td><td>Number of Shares</td></tr>",
      "<tr><td>Acme Holdings LLC</td><td>1,000,000</td></tr>",
      "</table>",
    ].join("");
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: "Common Stock",
        shares_offered: 5000000,
        price: 10,
        price_low: null,
        price_high: null,
        gross_proceeds: 50000000,
        net_proceeds: null,
        over_allotment_shares: null,
        units_offered: null,
        price_per_unit: null,
        unit_composition: null,
        warrant_fraction_per_unit: null,
        right_fraction_per_unit: null,
        trust_per_unit: null,
        over_allotment_units: null,
        exchange: null,
        par_value: null,
        confidence: 0.9,
        source_span: "5,000,000 shares",
        tickers: [],
      },
      {
        founder_shares: null,
        founder_percent: null,
        private_placement_warrants: null,
        private_placement_warrant_price: null,
        public_warrant_coverage: null,
        trust_per_public_share: null,
        trust_total: null,
        confidence: 0.9,
        source_span: "5,000,000 shares",
      },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1848507,
      file_number: "333-12",
      accession_number: "0000000000-26-000012",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: SPAC_HEADER,
        html,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    expect(await new UnderwriterLinkRepo().listByAccession("0000000000-26-000012")).toEqual([]);
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(dl.filter((d) => d.section_name === "underwriters")).toEqual([]);
  });
});
