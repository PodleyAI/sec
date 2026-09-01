/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { XbrlFactRepo } from "../../../storage/xbrl/XbrlFactRepo";
import { processFormS1Structured } from "./Form_S_1.storage";

const ACCESSION = "0000000000-26-000777";
const CIK = 2114227;

/** Cover-page-style iXBRL tagging plus one numeric SPAC fact; no extractable sections. */
const IXBRL_HTML =
  `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"` +
  ` xmlns:xbrli="http://www.xbrl.org/2003/instance"` +
  ` xmlns:dei="http://xbrl.sec.gov/dei/2025"` +
  ` xmlns:spac="http://xbrl.sec.gov/spac/2025q3"><body>` +
  `<div style="display:none"><ix:header><ix:resources>` +
  `<xbrli:context id="c1"><xbrli:entity>` +
  `<xbrli:identifier scheme="http://www.sec.gov/CIK">0002114227</xbrli:identifier></xbrli:entity>` +
  `<xbrli:period><xbrli:instant>2026-03-31</xbrli:instant></xbrli:period></xbrli:context>` +
  `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>` +
  `</ix:resources></ix:header></div>` +
  `<p><ix:nonNumeric contextRef="c1" name="dei:EntityRegistrantName">Synthetic SPAC Corp</ix:nonNumeric></p>` +
  `<p><ix:nonNumeric contextRef="c1" name="dei:EntityIncorporationStateCountryCode">Delaware</ix:nonNumeric></p>` +
  `<p><ix:nonNumeric contextRef="c1" name="dei:EntityAddressAddressLine1">640 Fifth Avenue</ix:nonNumeric>,` +
  ` <ix:nonNumeric contextRef="c1" name="dei:EntityAddressCityOrTown">New York</ix:nonNumeric>,` +
  ` <ix:nonNumeric contextRef="c1" name="dei:EntityAddressStateOrProvince">NY</ix:nonNumeric>` +
  ` <ix:nonNumeric contextRef="c1" name="dei:EntityAddressPostalZipCode">10019</ix:nonNumeric></p>` +
  `<p>(<ix:nonNumeric contextRef="c1" name="dei:CityAreaCode">212</ix:nonNumeric>)` +
  ` <ix:nonNumeric contextRef="c1" name="dei:LocalPhoneNumber">380-7500</ix:nonNumeric></p>` +
  `<p>Trust: $<ix:nonFraction contextRef="c1" unitRef="usd" name="spac:AssetsHeldInTrustNoncurrent"` +
  ` decimals="0" format="ixt:num-dot-decimal" scale="0">250,000,000</ix:nonFraction></p>` +
  `</body></html>`;

/** Minimal ffd-taxonomy EX-FILING FEES exhibit (its own iXBRL document). */
const FEE_EXHIBIT_HTML =
  `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"` +
  ` xmlns:xbrli="http://www.xbrl.org/2003/instance"` +
  ` xmlns:ffd="http://xbrl.sec.gov/ffd/2025"><body>` +
  `<div style="display:none"><ix:header><ix:resources>` +
  `<xbrli:context id="f1"><xbrli:entity>` +
  `<xbrli:identifier scheme="http://www.sec.gov/CIK">0002114227</xbrli:identifier></xbrli:entity>` +
  `<xbrli:period><xbrli:instant>2026-04-02</xbrli:instant></xbrli:period></xbrli:context>` +
  `<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>` +
  `</ix:resources></ix:header></div>` +
  `<p>Total: $<ix:nonFraction contextRef="f1" unitRef="usd" name="ffd:TtlOfferingAmt"` +
  ` decimals="0" format="ixt:num-dot-decimal" scale="0">345,000,000</ix:nonFraction></p>` +
  `</body></html>`;

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

describe("processFormS1Structured XBRL integration", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("stores facts and enriches the issuer observation from dei cover-page facts", async () => {
    await processFormS1Structured({
      cik: CIK,
      file_number: "333-2",
      accession_number: ACCESSION,
      filing_date: "2026-04-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: IXBRL_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: FEE_EXHIBIT_HTML,
      },
    });

    const facts = await new XbrlFactRepo().getByAccession(ACCESSION);
    expect(facts).toHaveLength(10); // 9 primary-doc facts + 1 fee-exhibit fact

    // Fee-exhibit facts continue the fact_index sequence and are labeled.
    const fee = facts.find((f) => f.concept === "ffd:TtlOfferingAmt")!;
    expect(fee.source).toBe("fee-exhibit");
    expect(fee.fact_index).toBe(9);
    expect(fee.value_numeric).toBe(345000000);
    expect(fee.unit).toBe("USD");
    expect(fee.period_instant).toBe("2026-04-02");
    expect(facts.filter((f) => f.source === "inline")).toHaveLength(9);
    const trust = facts.find((f) => f.concept === "spac:AssetsHeldInTrustNoncurrent")!;
    expect(trust.value_numeric).toBe(250000000);
    expect(trust.unit).toBe("USD");
    expect(trust.period_instant).toBe("2026-03-31");
    expect(trust.cik).toBe(CIK);

    const issuer = (await new CompanyObservationRepo().listAll()).find(
      (c) => c.cik === CIK && c.accession_number === ACCESSION
    )!;
    expect(issuer.name).toBe("Synthetic SPAC Corp");
    expect(issuer.jurisdiction).toBe("Delaware");
    expect(issuer.raw_phone_id).toBe("+1 212-380-7500");
    expect(issuer.raw_address_id).not.toBeNull();
    expect(JSON.parse(issuer.source_context!)).toEqual({
      relation: "s1:issuer",
      attributes_source: "xbrl-dei",
    });

    const address = await new AddressRepo().getAddress(issuer.raw_address_id!);
    expect(address?.city).toBe("NEW YORK");
  });

  it("parses a standalone instance document when the HTML carries no inline tags", async () => {
    const instance = `<?xml version="1.0"?>
      <xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2014-01-31">
        <xbrli:context id="d1"><xbrli:entity>
          <xbrli:identifier scheme="http://www.sec.gov/CIK">0002114227</xbrli:identifier></xbrli:entity>
          <xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period>
        </xbrli:context>
        <dei:EntityRegistrantName contextRef="d1">Instance Only Corp</dei:EntityRegistrantName>
      </xbrli:xbrl>`;

    await processFormS1Structured({
      cik: CIK,
      file_number: "333-2",
      accession_number: ACCESSION,
      filing_date: "2026-04-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: "<html><body><p>Plain.</p></body></html>",
        xbrlInstanceXml: instance,
        feeExhibitHtml: null,
      },
    });

    const facts = await new XbrlFactRepo().getByAccession(ACCESSION);
    expect(facts).toHaveLength(1);
    expect(facts[0].source).toBe("instance");

    const issuer = (await new CompanyObservationRepo().listAll()).find((c) => c.cik === CIK)!;
    expect(issuer.name).toBe("Instance Only Corp");
  });

  it("stores fee-exhibit facts even when the prospectus itself is untagged", async () => {
    await processFormS1Structured({
      cik: CIK,
      file_number: "333-2",
      accession_number: ACCESSION,
      filing_date: "2026-04-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: "<html><body><p>No tagging.</p></body></html>",
        xbrlInstanceXml: null,
        feeExhibitHtml: FEE_EXHIBIT_HTML,
      },
    });

    const facts = await new XbrlFactRepo().getByAccession(ACCESSION);
    expect(facts).toHaveLength(1);
    expect(facts[0].concept).toBe("ffd:TtlOfferingAmt");
    expect(facts[0].source).toBe("fee-exhibit");

    // No dei cover-page facts were recovered, so the issuer stays unlabeled.
    const issuer = (await new CompanyObservationRepo().listAll()).find((c) => c.cik === CIK)!;
    expect(issuer.name).toBeNull();
    expect(JSON.parse(issuer.source_context!)).toEqual({ relation: "s1:issuer" });
  });

  it("stores facts but skips issuer enrichment when the dei CIK mismatches the filing CIK", async () => {
    // Same shape as IXBRL_HTML but tagged for a DIFFERENT registrant CIK.
    const wrongCikHtml = IXBRL_HTML.replace(
      `<p><ix:nonNumeric contextRef="c1" name="dei:EntityRegistrantName">`,
      `<p><ix:nonNumeric contextRef="c1" name="dei:EntityCentralIndexKey">0000099999</ix:nonNumeric>` +
        `<ix:nonNumeric contextRef="c1" name="dei:EntityRegistrantName">`
    );

    await processFormS1Structured({
      cik: CIK,
      file_number: "333-2",
      accession_number: ACCESSION,
      filing_date: "2026-04-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: wrongCikHtml,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
    });

    // Facts are stored regardless...
    expect(await new XbrlFactRepo().countByAccession(ACCESSION)).toBe(10);
    // ...but the wrong entity's attributes never reach the issuer observation.
    const issuer = (await new CompanyObservationRepo().listAll()).find((c) => c.cik === CIK)!;
    expect(issuer.name).toBeNull();
    expect(issuer.jurisdiction).toBeNull();
    expect(JSON.parse(issuer.source_context!)).toEqual({ relation: "s1:issuer" });
  });

  it("leaves the issuer observation bare for untagged filings", async () => {
    await processFormS1Structured({
      cik: CIK,
      file_number: "333-2",
      accession_number: ACCESSION,
      filing_date: "2026-04-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: "<html><body><p>No tagging.</p></body></html>",
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
    });

    expect(await new XbrlFactRepo().countByAccession(ACCESSION)).toBe(0);
    const issuer = (await new CompanyObservationRepo().listAll()).find((c) => c.cik === CIK)!;
    expect(issuer.name).toBeNull();
    expect(JSON.parse(issuer.source_context!)).toEqual({ relation: "s1:issuer" });
  });
});
