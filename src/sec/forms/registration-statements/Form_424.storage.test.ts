/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CompanyIdentityLinkRepo } from "../../../storage/canonical/CompanyIdentityLinkRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { IssuerTickerRepo } from "../../../storage/offering/IssuerTickerRepo";
import { SpacUnitTermsRepo } from "../../../storage/offering/SpacUnitTermsRepo";
import { XbrlFactRepo } from "../../../storage/xbrl/XbrlFactRepo";
import { ipoProceeds, ipoTrustAmount, isPricedIpoProspectus, processForm424 } from "./Form_424.storage";
import { processFormS1 } from "./Form_S_1.storage";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import { offeringSectionNames } from "./s1/offeringSections";
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

  describe("SPAC IPO event on AI degradation", () => {
    // The priced prospectus IS the SPAC IPO — the deterministic lifecycle
    // event must record even when the AI offering-sections pass degrades
    // (model resolution fails, HTML fails to segment). Otherwise the SPAC
    // report's ipo_date, spac_deal correlation, and status advance are held
    // hostage to model availability.

    const SPAC_HEADER = {
      sic: 6770,
      sicDescription: "BLANK CHECKS",
      cik: CIK,
      companyName: "Synthetic SPAC Corp",
      filingDate: "20260428",
    };

    it("fills ipo_proceeds from the prospectus cover when unit terms are missing (424B4)", async () => {
      // Live: Cambridge Acquisition Corp. 424B4 0001104659-26-011571 (CIK
      // 2100125). The cover prints "$200,000,000 / 20,000,000 Units"; "The
      // Offering" span check wiped the AI unit-terms row, so arithmetic from
      // units × price never ran and ipo_proceeds stayed null while trust
      // filled from promote. The cover is deterministic SPAC-IPO bookkeeping
      // — same class of fact as recording the ipo event itself.
      await processForm424({
        cik: CIK,
        file_number: "333-292147",
        accession_number: B4_ACCESSION,
        filing_date: "2026-02-06",
        primary_doc: "none-20260129x424b4.htm",
        form: "424B4",
        form424: {
          header: SPAC_HEADER,
          html: `<html><body>
<p>PROSPECTUS</p>
<p>Filed Pursuant to Rule 424(b)(4)</p>
<p>Registration No. 333-292147</p>
<p>$200,000,000</p>
<p>Cambridge Acquisition Corp.</p>
<p>20,000,000 Units</p>
<p>Cambridge Acquisition Corp. is a blank check company.</p>
<p>This is an initial public offering of our securities. Each unit has an
offering price of $10.00.</p>
</body></html>`,
          xbrlInstanceXml: null,
          feeExhibitHtml: null,
        },
      });

      const spac = await new SpacRepo().getSpac(CIK);
      expect(spac?.ipo_date).toBe("2026-02-06");
      expect(spac?.ipo_proceeds).toBe(200_000_000);
    });

    it("records the IPO event + deal even when the AI model fails to resolve (424B4)", async () => {
      // No fake provider registered; getS1Model() throws with the configured
      // model unregistered, which used to abort the whole filing before it
      // reached the deterministic IPO-event bookkeeping. The catch now
      // dead-letters the AI sections under MODEL_RESOLUTION_ERROR and calls
      // the shared recordSpacIpoEventIfEligible helper.
      await processForm424({
        cik: CIK,
        file_number: "333-000001",
        accession_number: B4_ACCESSION,
        filing_date: "2026-04-28",
        primary_doc: "424b4.htm",
        form: "424B4",
        form424: {
          header: SPAC_HEADER,
          html: "<h1>THE OFFERING</h1><p>30,000,000 units at $10.00.</p>",
          xbrlInstanceXml: null,
          feeExhibitHtml: null,
        },
        // No `model:` — forces getS1Model() through and fail.
      });

      const spac = await new SpacRepo().getSpac(CIK);
      expect(spac).toBeDefined();
      // The consolidated SPAC row exists and has recorded the IPO event's
      // filing_date. ipo_proceeds / trust_amount stay null because no
      // unitTerms row was produced (AI never ran).
      expect(spac?.ipo_date).toBe("2026-04-28");
      expect(spac?.ipo_proceeds ?? null).toBeNull();
      expect(spac?.trust_amount ?? null).toBeNull();

      // The lifecycle ipo event was appended (recordIpo -> appendEvent),
      // so the SPAC's event stream carries an `ipo` at this filing_date.
      const events = await new SpacRepo().getEvents(CIK);
      expect(events.filter((e) => e.event_type === "ipo")).toHaveLength(1);

      const dl = await new ExtractionDeadLetterRepo().listPending("424");
      // Every AI offering section dead-lettered under MODEL_RESOLUTION_ERROR.
      const sectionReasons = new Map(dl.map((d) => [d.section_name, d.reason_code]));
      // This fixture is a SPAC (SIC 6770), so sponsor-promote is in scope.
      for (const s of offeringSectionNames(true)) {
        expect(sectionReasons.get(s)).toBe("MODEL_RESOLUTION_ERROR");
      }
    });

    it("records the IPO event + deal even when HTML segmentation fails (424B4)", async () => {
      // Force the PARSE_ERROR branch by making the segmenter throw. The catch
      // must still call recordSpacIpoEventIfEligible so the deterministic
      // SPAC lifecycle advances.
      const spy = vi.spyOn(DocumentTreeSegmenter.prototype, "segment").mockImplementation(() => {
        throw new Error("synthetic segmenter failure");
      });
      try {
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
            header: SPAC_HEADER,
            html: "<h1>THE OFFERING</h1><p>30,000,000 units at $10.00.</p>",
            xbrlInstanceXml: null,
            feeExhibitHtml: null,
          },
          model: fakeS1Model(),
        });

        const spac = await new SpacRepo().getSpac(CIK);
        expect(spac).toBeDefined();
        expect(spac?.ipo_date).toBe("2026-04-28");

        const events = await new SpacRepo().getEvents(CIK);
        expect(events.filter((e) => e.event_type === "ipo")).toHaveLength(1);

        const dl = await new ExtractionDeadLetterRepo().listPending("424");
        const sectionReasons = new Map(dl.map((d) => [d.section_name, d.reason_code]));
        for (const s of offeringSectionNames(true)) {
          expect(sectionReasons.get(s)).toBe("PARSE_ERROR");
        }
      } finally {
        spy.mockRestore();
      }
    });

    it("does NOT record an IPO event for a non-priced 424 (424B2)", async () => {
      // A shelf-takedown 424B2 is not an IPO event and must not advance the
      // SPAC lifecycle — even though the header claims sic=6770. This
      // regression protects against the helper being called from too high
      // up the control flow.
      await processForm424({
        cik: CIK,
        file_number: "333-000001",
        accession_number: B4_ACCESSION,
        filing_date: "2026-04-28",
        primary_doc: "424b2.htm",
        form: "424B2",
        form424: {
          header: SPAC_HEADER,
          html: "<h1>THE OFFERING</h1><p>Notes linked to an index.</p>",
          xbrlInstanceXml: null,
          feeExhibitHtml: null,
        },
      });

      // No spac row (this filing didn't create one).
      expect(await new SpacRepo().getSpac(CIK)).toBeUndefined();
    });

    it("records an IPO from a 424B3 when a spac row exists and ipo_date is still null", async () => {
      // Aimfinity / Spring Valley III: the IPO prospectus is a 424B3, not B1/B4.
      await new SpacReportWriter().recordRegistration({
        cik: CIK,
        accession_number: S1_ACCESSION,
        filing_date: "2025-08-01",
        form: "S-1",
        primary_document: "s1.htm",
        spac_name: "Synthetic SPAC Corp",
        spac_sic: 6770,
      });
      expect((await new SpacRepo().getSpac(CIK))?.ipo_date).toBeNull();

      await processForm424({
        cik: CIK,
        file_number: "333-000001",
        accession_number: B4_ACCESSION,
        filing_date: "2025-09-04",
        primary_doc: "424b3.htm",
        form: "424B3",
        form424: {
          header: NULL_HEADER,
          html: "<h1>PROSPECTUS</h1><p>$80,500,000</p><p>8,050,000 Units</p>",
          xbrlInstanceXml: null,
          feeExhibitHtml: null,
        },
      });

      const spac = await new SpacRepo().getSpac(CIK);
      expect(spac?.ipo_date).toBe("2025-09-04");
      const events = await new SpacRepo().getEvents(CIK);
      expect(events.filter((e) => e.event_type === "ipo")).toHaveLength(1);
    });

    it("does NOT record an IPO from a de-SPAC proxy 424B3", async () => {
      await new SpacReportWriter().recordRegistration({
        cik: CIK,
        accession_number: S1_ACCESSION,
        filing_date: "2023-06-16",
        form: "S-1",
        primary_document: "s1.htm",
        spac_name: "Synthetic SPAC Corp",
        spac_sic: 6770,
      });

      await processForm424({
        cik: CIK,
        file_number: "333-000001",
        accession_number: B4_ACCESSION,
        filing_date: "2024-02-14",
        primary_doc: "f424b3.htm",
        form: "424B3",
        form424: {
          header: NULL_HEADER,
          html: `<html><body>
<h1>PROXY STATEMENT FOR SPECIAL MEETING OF SHAREHOLDERS</h1>
<p>Dear Shareholders: You are cordially invited to attend the special meeting.</p>
<p>The Company has entered into a merger agreement. The aggregate consideration
is $50,000,000, payable in newly issued ordinary shares.</p>
</body></html>`,
          xbrlInstanceXml: null,
          feeExhibitHtml: null,
        },
      });

      const spac = await new SpacRepo().getSpac(CIK);
      expect(spac?.ipo_date).toBeNull();
      const events = await new SpacRepo().getEvents(CIK);
      expect(events.filter((e) => e.event_type === "ipo")).toHaveLength(0);
    });

    it("does NOT record a second IPO from a later 424B3 once ipo_date is set", async () => {
      await processForm424({
        cik: CIK,
        file_number: "333-000001",
        accession_number: B4_ACCESSION,
        filing_date: "2026-04-28",
        primary_doc: "424b4.htm",
        form: "424B4",
        form424: {
          header: SPAC_HEADER,
          html: "<h1>THE OFFERING</h1><p>30,000,000 units at $10.00.</p>",
          xbrlInstanceXml: null,
          feeExhibitHtml: null,
        },
      });
      expect((await new SpacRepo().getSpac(CIK))?.ipo_date).toBe("2026-04-28");

      const later = "0000000000-26-000803";
      await processForm424({
        cik: CIK,
        file_number: "333-000001",
        accession_number: later,
        filing_date: "2026-05-15",
        primary_doc: "424b3.htm",
        form: "424B3",
        form424: {
          header: SPAC_HEADER,
          html: "<h1>PROSPECTUS SUPPLEMENT</h1><p>Additional shares.</p>",
          xbrlInstanceXml: null,
          feeExhibitHtml: null,
        },
      });

      const events = await new SpacRepo().getEvents(CIK);
      expect(events.filter((e) => e.event_type === "ipo")).toHaveLength(1);
      const dl = await new ExtractionDeadLetterRepo().listPending("424");
      expect(dl.filter((d) => d.accession_number === later)).toEqual([]);
    });
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

describe("ipoProceeds", () => {
  it("prefers a stated gross_proceeds figure", () => {
    expect(
      ipoProceeds({
        gross_proceeds: 201_000_000,
        price_per_unit: 10,
        units_offered: 20_000_000,
        cover_proceeds: 200_000_000,
      })
    ).toBe(201_000_000);
  });

  it("multiplies price × units when gross_proceeds is missing", () => {
    expect(
      ipoProceeds({
        gross_proceeds: null,
        price_per_unit: 10,
        units_offered: 20_000_000,
        cover_proceeds: 200_000_000,
      })
    ).toBe(200_000_000);
  });

  it("falls back to the cover headline when the unit-terms row is missing", () => {
    // Live: Cambridge Acquisition Corp. 424B4 (CIK 2100125) — offering-terms
    // wiped by UNVERIFIED_SOURCE_SPAN, cover still prints $200,000,000.
    expect(
      ipoProceeds({
        gross_proceeds: null,
        price_per_unit: null,
        units_offered: null,
        cover_proceeds: 200_000_000,
      })
    ).toBe(200_000_000);
  });

  it("returns null when nothing is available", () => {
    expect(
      ipoProceeds({
        gross_proceeds: null,
        price_per_unit: 10,
        units_offered: null,
        cover_proceeds: null,
      })
    ).toBeNull();
  });
});

describe("ipoTrustAmount", () => {
  it("multiplies trust_per_unit by units_offered when both are present", () => {
    expect(
      ipoTrustAmount({
        trust_per_unit: 10,
        units_offered: 20_000_000,
        trust_total: 250_000_000,
      })
    ).toBe(200_000_000);
  });

  it("falls back to promote trust_total when units_offered is missing", () => {
    // Live: Fortress Value Acquisition V 424B4 (CIK 1850733) extracted
    // trust_per_unit=$10 and trust_total=$250M but left units_offered null,
    // so the IPO row got proceeds and a null trust.
    expect(
      ipoTrustAmount({
        trust_per_unit: 10,
        units_offered: null,
        trust_total: 250_000_000,
      })
    ).toBe(250_000_000);
  });

  it("returns null when neither the product nor trust_total is available", () => {
    expect(
      ipoTrustAmount({
        trust_per_unit: 10,
        units_offered: null,
        trust_total: null,
      })
    ).toBeNull();
  });
});

describe("isPricedIpoProspectus", () => {
  const noIpo = { knownSpac: false, ipoDate: null, headerSic: null };

  it("treats 424B1 and 424B4 as priced regardless of SPAC state", () => {
    expect(isPricedIpoProspectus("424B4", noIpo)).toBe(true);
    expect(isPricedIpoProspectus("424B1", noIpo)).toBe(true);
  });

  it("does not treat shelf takedowns as priced", () => {
    expect(isPricedIpoProspectus("424B2", { ...noIpo, headerSic: 6770 })).toBe(false);
    expect(isPricedIpoProspectus("424B5", { ...noIpo, knownSpac: true })).toBe(false);
  });

  it("treats 424B3 as priced for a known SPAC that has not IPOed", () => {
    expect(isPricedIpoProspectus("424B3", { knownSpac: true, ipoDate: null, headerSic: null })).toBe(
      true
    );
  });

  it("treats 424B3 as priced when the header is SIC 6770 even without a spac row", () => {
    expect(isPricedIpoProspectus("424B3", { knownSpac: false, ipoDate: null, headerSic: 6770 })).toBe(
      true
    );
  });

  it("does not treat a later 424B3 as priced once ipo_date is set", () => {
    expect(
      isPricedIpoProspectus("424B3", { knownSpac: true, ipoDate: "2025-09-04", headerSic: 6770 })
    ).toBe(false);
  });

  it("does not treat a de-SPAC proxy 424B3 as a priced IPO", () => {
    // NewGenIvf / Broad Capital: S-4/F-4 424B3 is a proxy statement/prospectus
    // for the combination, not the blank-check IPO. Stamping `ipo` from it
    // left proceeds null (cover parse finds no Units headline) and blocked
    // a later RW from becoming `withdrawn`.
    const html = `<html><body>
<h1>PROXY STATEMENT FOR SPECIAL MEETING OF SHAREHOLDERS</h1>
<p>Dear Shareholders: You are cordially invited to attend the special meeting
of the shareholders of A SPAC I Acquisition Corp.</p>
<p>ASCA has entered into a merger agreement with NewGenIvf Limited. The
aggregate consideration for the Acquisition Merger is $50,000,000.</p>
</body></html>`;
    expect(
      isPricedIpoProspectus("424B3", {
        knownSpac: true,
        ipoDate: null,
        headerSic: null,
        html,
      })
    ).toBe(false);
  });

  it("still treats a 424B3 as priced when the body is an IPO prospectus", () => {
    const html = `<html><body>
<p>$80,500,000</p>
<p>8,050,000 Units</p>
<p>This is an initial public offering of our securities.</p>
</body></html>`;
    expect(
      isPricedIpoProspectus("424B3", {
        knownSpac: true,
        ipoDate: null,
        headerSic: null,
        html,
      })
    ).toBe(true);
  });
});
