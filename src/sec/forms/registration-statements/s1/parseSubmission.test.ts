/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseRegistrationSubmission, parseSecHeader } from "./parseSubmission";

const TXT = [
  "<SEC-HEADER>0001193125-21-066104.hdr.sgml : 20210302",
  "ACCESSION NUMBER:		0001193125-21-066104",
  "CONFORMED SUBMISSION TYPE:	S-1",
  "FILED AS OF DATE:		20210302",
  "FILER:",
  "	COMPANY DATA:	",
  "		COMPANY CONFORMED NAME:			1.12 Acquisition Corp",
  "		CENTRAL INDEX KEY:			0001848507",
  "		STANDARD INDUSTRIAL CLASSIFICATION:	BLANK CHECKS [6770]",
  "</SEC-HEADER>",
  "<DOCUMENT>",
  "<TYPE>S-1",
  "<SEQUENCE>1",
  "<FILENAME>d141894ds1.htm",
  "<DESCRIPTION>FORM S-1",
  "<TEXT>",
  "<html><body><h1>MANAGEMENT</h1></body></html>",
  "</TEXT>",
  "</DOCUMENT>",
  "<DOCUMENT>",
  "<TYPE>EX-23.1",
  "<SEQUENCE>2",
  "<FILENAME>consent.htm",
  "<TEXT>",
  "<html><body>exhibit</body></html>",
  "</TEXT>",
  "</DOCUMENT>",
].join("\n");

describe("parseSecHeader", () => {
  it("extracts sic, description, cik, name, and filing date", () => {
    const h = parseSecHeader(TXT);
    expect(h.sic).toBe(6770);
    expect(h.sicDescription).toBe("BLANK CHECKS");
    expect(h.cik).toBe(1848507);
    expect(h.companyName).toBe("1.12 Acquisition Corp");
    expect(h.filingDate).toBe("20210302");
  });

  it("returns all-null when no header is present", () => {
    const h = parseSecHeader("<DOCUMENT><TYPE>S-1<TEXT><html></html></TEXT></DOCUMENT>");
    expect(h.sic).toBeNull();
    expect(h.cik).toBeNull();
  });

  it("reads the dissemination `.nc` tagged header (Feed tarball members)", () => {
    // Shape taken verbatim from a real 20210305 Feed member — no <SEC-HEADER>
    // block, tagged <SUBMISSION> fields instead. Line-anchored fallbacks must
    // ignore <OWNER-CIK> / <FORMER-CONFORMED-NAME> and take the primary filer.
    const nc = [
      "<SUBMISSION>",
      "<ACCESSION-NUMBER>0001628280-21-003998",
      "<TYPE>S-1",
      "<FILING-DATE>20210305",
      "<DATE-OF-FILING-DATE-CHANGE>20210305",
      "<FILER>",
      "<COMPANY-DATA>",
      "<CONFORMED-NAME>IMMERSION CORP",
      "<CIK>0001058811",
      "<ASSIGNED-SIC>3577",
      "</COMPANY-DATA>",
      "<FORMER-COMPANY>",
      "<FORMER-CONFORMED-NAME>OLD IMMERSION NAME",
      "</FORMER-COMPANY>",
      "</FILER>",
      "<SERIES>",
      "<OWNER-CIK>0009999999",
      "</SERIES>",
      "<DOCUMENT>",
      "<TYPE>S-1",
      "<FILENAME>immr.htm",
      "<TEXT>",
      "<html></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "</SUBMISSION>",
    ].join("\n");
    const h = parseSecHeader(nc);
    expect(h.sic).toBe(3577);
    expect(h.cik).toBe(1058811); // <CIK>, not <OWNER-CIK>
    expect(h.companyName).toBe("IMMERSION CORP"); // not <FORMER-CONFORMED-NAME>
    expect(h.filingDate).toBe("20210305");
    // .nc carries only the numeric SIC, so the human-readable description is absent.
    expect(h.sicDescription).toBeNull();
  });
});

describe("parseRegistrationSubmission", () => {
  it("selects the primary DOCUMENT body and returns the header", () => {
    const parsed = parseRegistrationSubmission("S-1", TXT);
    expect(parsed.header.sic).toBe(6770);
    expect(parsed.html).toContain("MANAGEMENT");
    expect(parsed.html).not.toContain("exhibit");
    expect(parsed.html).not.toContain("<TYPE>");
    expect(parsed.xbrlInstanceXml).toBeNull();
    expect(parsed.feeExhibitHtml).toBeNull();
  });

  it("surfaces the EX-FILING FEES exhibit body", () => {
    const withFee = [
      TXT,
      "<DOCUMENT>",
      "<TYPE>EX-FILING FEES",
      "<SEQUENCE>3",
      "<FILENAME>ex-fee.htm",
      "<TEXT>",
      `<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"><body>fee table</body></html>`,
      "</TEXT>",
      "</DOCUMENT>",
    ].join("\n");
    const parsed = parseRegistrationSubmission("S-1", withFee);
    expect(parsed.html).toContain("MANAGEMENT");
    expect(parsed.feeExhibitHtml).toContain("fee table");
  });

  it("surfaces an EX-101.INS instance document", () => {
    const withInstance = [
      TXT,
      "<DOCUMENT>",
      "<TYPE>EX-101.INS",
      "<SEQUENCE>4",
      "<FILENAME>abc-20140101.xml",
      "<TEXT>",
      `<?xml version="1.0"?><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"></xbrli:xbrl>`,
      "</TEXT>",
      "</DOCUMENT>",
    ].join("\n");
    const parsed = parseRegistrationSubmission("S-1", withInstance);
    expect(parsed.xbrlInstanceXml).toContain("xbrli:xbrl");
  });

  it("falls back to the whole input as body when there is no DOCUMENT envelope", () => {
    const bare = "<html><body><h1>MANAGEMENT</h1></body></html>";
    const parsed = parseRegistrationSubmission("S-1", bare);
    expect(parsed.header.sic).toBeNull();
    expect(parsed.html).toContain("MANAGEMENT");
  });

  it("matches the dispatched form TYPE for DRS", () => {
    const drs = TXT.replace("<TYPE>S-1", "<TYPE>DRS").replace(
      "CONFORMED SUBMISSION TYPE:	S-1",
      "CONFORMED SUBMISSION TYPE:	DRS"
    );
    const parsed = parseRegistrationSubmission("DRS", drs);
    expect(parsed.html).toContain("MANAGEMENT");
  });
});
