/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { processForm424 } from "./Form_424.storage";
import { processFormS1 } from "./Form_S_1.storage";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { CompanyIdentityLinkRepo } from "../../../storage/canonical/CompanyIdentityLinkRepo";
import { XbrlFactRepo } from "../../../storage/xbrl/XbrlFactRepo";
import { SpacUnitTermsRepo } from "../../../storage/offering/SpacUnitTermsRepo";
import { IssuerTickerRepo } from "../../../storage/offering/IssuerTickerRepo";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const CIK = 2114227;
const S1_ACCESSION = "0000000000-26-000801";
const B4_ACCESSION = "0000000000-26-000802";

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

/** iXBRL-tagged S-1 primary doc: registrant name + one numeric fact. */
const S1_HTML =
  `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"` +
  ` xmlns:xbrli="http://www.xbrl.org/2003/instance"` +
  ` xmlns:dei="http://xbrl.sec.gov/dei/2025"><body>` +
  `<div style="display:none"><ix:header><ix:resources>` +
  `<xbrli:context id="c1"><xbrli:entity>` +
  `<xbrli:identifier scheme="http://www.sec.gov/CIK">0002114227</xbrli:identifier></xbrli:entity>` +
  `<xbrli:period><xbrli:instant>2026-03-31</xbrli:instant></xbrli:period></xbrli:context>` +
  `</ix:resources></ix:header></div>` +
  `<p><ix:nonNumeric contextRef="c1" name="dei:EntityRegistrantName">Synthetic SPAC Corp</ix:nonNumeric></p>` +
  `</body></html>`;

/** Pay-as-you-go style EX-FILING FEES exhibit for the priced 424B4. */
const B4_FEE_EXHIBIT =
  `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"` +
  ` xmlns:xbrli="http://www.xbrl.org/2003/instance"` +
  ` xmlns:ffd="http://xbrl.sec.gov/ffd/2025"><body>` +
  `<div style="display:none"><ix:header><ix:resources>` +
  `<xbrli:context id="f1"><xbrli:entity>` +
  `<xbrli:identifier scheme="http://www.sec.gov/CIK">0002114227</xbrli:identifier></xbrli:entity>` +
  `<xbrli:period><xbrli:instant>2026-04-28</xbrli:instant></xbrli:period></xbrli:context>` +
  `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>` +
  `</ix:resources></ix:header></div>` +
  `<p><ix:nonNumeric contextRef="f1" name="ffd:RegnFileNb">333-000001</ix:nonNumeric></p>` +
  `<p>$<ix:nonFraction contextRef="f1" unitRef="usd" name="ffd:TtlOfferingAmt"` +
  ` decimals="0" format="ixt:num-dot-decimal" scale="0">300,000,000</ix:nonFraction></p>` +
  `</body></html>`;

let cleanup: (() => void) | undefined;

describe("processForm424", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("stores fee-exhibit facts and resolves the issuer to the same canonical company as the S-1", async () => {
    const { unregister } = registerFakeStructuredProvider([]);
    cleanup = unregister;

    await processFormS1({
      cik: CIK,
      file_number: "333-000001",
      accession_number: S1_ACCESSION,
      filing_date: "2026-04-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: S1_HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    await processForm424({
      cik: CIK,
      file_number: "333-000001",
      accession_number: B4_ACCESSION,
      filing_date: "2026-04-28",
      primary_doc: "424b4.htm",
      form: "424B4",
      form424: {
        header: NULL_HEADER,
        html: "<html><body><p>Final prospectus (untagged body).</p></body></html>",
        xbrlInstanceXml: null,
        feeExhibitHtml: B4_FEE_EXHIBIT,
      },
      model: fakeS1Model(),
    });

    const facts = await new XbrlFactRepo().getByAccession(B4_ACCESSION);
    expect(facts).toHaveLength(2);
    expect(facts.every((f) => f.source === "fee-exhibit")).toBe(true);
    const total = facts.find((f) => f.concept === "ffd:TtlOfferingAmt")!;
    expect(total.value_numeric).toBe(300000000);
    const fileNb = facts.find((f) => f.concept === "ffd:RegnFileNb")!;
    expect(fileNb.value_text).toBe("333-000001");

    const observations = await new CompanyObservationRepo().listAll();
    const s1Issuer = observations.find(
      (o) => o.accession_number === S1_ACCESSION && o.extractor_id === "S-1"
    )!;
    const b4Issuer = observations.find(
      (o) => o.accession_number === B4_ACCESSION && o.extractor_id === "424"
    )!;
    expect(JSON.parse(b4Issuer.source_context!).relation).toBe("424:issuer");

    const links = new CompanyIdentityLinkRepo();
    const s1Link = await links.getForObservation(s1Issuer.observation_id, "1.0.0");
    const b4Link = await links.getForObservation(b4Issuer.observation_id, "1.0.0");
    expect(s1Link?.canonical_company_id).toBeDefined();
    expect(s1Link?.canonical_company_id).toBe(b4Link?.canonical_company_id!);
  });

  it("extracts FINAL offering terms from a priced 424B4 under extractor id '424'", async () => {
    // Sections present: The Offering + Underwriting -> offering-terms (1st model
    // call), then underwriters (2nd). Use-of-proceeds absent.
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
        // Substring of the offering-terms section text (verifyRow gate).
        source_span: "30,000,000 units",
        tickers: [
          { ticker: "CCXII", exchange: "NASDAQ", security_type: "Units", is_primary: true },
        ],
      },
      { underwriters: [] },
    ]);
    cleanup = unregister;

    const OFFERING_HTML = [
      "<h1>THE OFFERING</h1><p>We are offering 30,000,000 units at $10.00.</p>",
      "<h1>UNDERWRITING</h1><p>BTIG, LLC is the book-running manager.</p>",
    ].join("");
    const SPAC_HEADER = {
      sic: 6770,
      sicDescription: "BLANK CHECKS",
      cik: CIK,
      companyName: "Synthetic SPAC Corp",
      filingDate: "20260428",
    };

    await processForm424({
      cik: CIK,
      file_number: "333-000001",
      accession_number: B4_ACCESSION,
      filing_date: "2026-04-28",
      primary_doc: "424b4.htm",
      form: "424B4",
      form424: {
        header: SPAC_HEADER,
        html: OFFERING_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const unit = await new SpacUnitTermsRepo().get("424", B4_ACCESSION);
    expect(unit?.units_offered).toBe(30000000);
    expect(unit?.price_per_unit).toBe(10);
    expect(unit?.gross_proceeds).toBe(300000000);
    expect(unit?.ticker).toBe("CCXII");
    // Final terms live under extractor id "424"; the S-1 rows are untouched.
    expect(await new SpacUnitTermsRepo().get("S-1", B4_ACCESSION)).toBeUndefined();
    const history = await new IssuerTickerRepo().history(CIK);
    expect(history.map((t) => t.ticker)).toEqual(["CCXII"]);
  });

  it("does not run AI extraction for shelf-takedown variants (424B2)", async () => {
    // No fake provider registered: a model call would throw, so completing
    // cleanly proves the deterministic-only path.
    await processForm424({
      cik: CIK,
      file_number: "333-000001",
      accession_number: B4_ACCESSION,
      filing_date: "2026-04-28",
      primary_doc: "424b2.htm",
      form: "424B2",
      form424: {
        header: NULL_HEADER,
        html: "<h1>THE OFFERING</h1><p>Notes linked to an index.</p>",
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
    });

    expect(await new SpacUnitTermsRepo().get("424", B4_ACCESSION)).toBeUndefined();
    const issuer = (await new CompanyObservationRepo().listAll()).find(
      (o) => o.accession_number === B4_ACCESSION
    )!;
    expect(JSON.parse(issuer.source_context!).relation).toBe("424:issuer");
  });

  it("handles a 424 with no XBRL anywhere (fees prepaid at registration)", async () => {
    const { unregister } = registerFakeStructuredProvider([]);
    cleanup = unregister;

    await processForm424({
      cik: CIK,
      file_number: "333-000001",
      accession_number: B4_ACCESSION,
      filing_date: "2026-04-28",
      primary_doc: "424b4.htm",
      form: "424B4",
      form424: {
        header: NULL_HEADER,
        html: "<html><body><p>Final prospectus.</p></body></html>",
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    expect(await new XbrlFactRepo().countByAccession(B4_ACCESSION)).toBe(0);
    const issuer = (await new CompanyObservationRepo().listAll()).find(
      (o) => o.accession_number === B4_ACCESSION
    )!;
    expect(issuer.cik).toBe(CIK);
    expect(issuer.name).toBeNull();
    expect(JSON.parse(issuer.source_context!)).toEqual({ relation: "424:issuer" });
  });
});
