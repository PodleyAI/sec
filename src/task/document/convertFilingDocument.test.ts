/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { conversionCandidates } from "./ConvertFilingDocumentTask";
import { convertFilingDocument, filingDocumentTitle } from "./convertFilingDocument";

const HEADING = 'style="font-weight:700;text-align:center;font-size:14pt"';

const BARE_HTML = `<html><body>
  <p>Cover page of the offering.</p>
  <p ${HEADING}>RISK FACTORS</p>
  <p>Investing involves risk.</p>
  <p ${HEADING}>USE OF PROCEEDS</p>
  <p>We intend to use the proceeds.</p>
</body></html>`;

const FULL_SUBMISSION = `<SEC-DOCUMENT>0001234567-26-000001.txt : 20260101
<SEC-HEADER>0001234567-26-000001.hdr.sgml : 20260101
COMPANY CONFORMED NAME: EXAMPLE ACQUISITION CORP
</SEC-HEADER>
<DOCUMENT>
<TYPE>S-1
<SEQUENCE>1
<FILENAME>example-s1.htm
<TEXT>
${BARE_HTML}
</TEXT>
</DOCUMENT>
<DOCUMENT>
<TYPE>EX-23.1
<SEQUENCE>2
<FILENAME>ex231.htm
<TEXT>
<html><body><p>Consent of independent registered public accounting firm.</p></body></html>
</TEXT>
</DOCUMENT>
</SEC-DOCUMENT>`;

describe("convertFilingDocument", () => {
  it("converts a bare primary document into ordered sections", () => {
    const result = convertFilingDocument("S-1", "0001234567-26-000001", BARE_HTML);
    expect(result.title).toBe("S-1 0001234567-26-000001");
    expect(result.sections.map((s) => s.title)).toEqual([
      "S-1 0001234567-26-000001",
      "RISK FACTORS",
      "USE OF PROCEEDS",
    ]);
    expect(result.sections.map((s) => s.slug)).toEqual([
      "s-1-0001234567-26-000001",
      "risk-factors",
      "use-of-proceeds",
    ]);
    expect(result.sections[1].markdown).toContain("Investing involves risk.");
    expect(result.charCount).toBe(result.sections.reduce((sum, s) => sum + s.markdown.length, 0));
  });

  it("takes the primary document out of a full submission and leaves the exhibits", () => {
    const result = convertFilingDocument("S-1", "0001234567-26-000001", FULL_SUBMISSION);
    const all = result.sections.map((s) => s.markdown).join("\n");
    expect(all).toContain("Investing involves risk.");
    // The EX-23.1 sibling is a separate <DOCUMENT>; converting the submission
    // must not fold it into the filing body.
    expect(all).not.toContain("Consent of independent registered");
    // Nor may the SGML header lines reach the reader as prose.
    expect(all).not.toContain("COMPANY CONFORMED NAME");
  });

  it("reads the same filing identically whichever shape the cache holds", () => {
    const bare = convertFilingDocument("S-1", "0001234567-26-000001", BARE_HTML);
    const full = convertFilingDocument("S-1", "0001234567-26-000001", FULL_SUBMISSION);
    expect(full.sections.map((s) => s.markdown)).toEqual(bare.sections.map((s) => s.markdown));
  });

  it("yields no sections for a document with no prose in it", () => {
    expect(
      convertFilingDocument("8-K", "0001-26-1", "<html><body></body></html>").sections
    ).toHaveLength(0);
  });

  it("names a filing carrying no form rather than rendering an empty title", () => {
    expect(filingDocumentTitle(null, "0001-26-1")).toBe("Filing 0001-26-1");
    expect(filingDocumentTitle("   ", "0001-26-1")).toBe("Filing 0001-26-1");
  });
});

describe("conversionCandidates", () => {
  it("prefers the full submission for a prospectus form, which is what the cache holds", () => {
    expect(conversionCandidates("S-1", "0001234567-26-000001", "example-s1.htm")).toEqual([
      "0001234567-26-000001.txt",
      "example-s1.htm",
    ]);
  });

  it("prefers the primary document for every other form", () => {
    expect(conversionCandidates("8-K", "0001234567-26-000001", "ex-8k.htm")).toEqual([
      "ex-8k.htm",
      "0001234567-26-000001.txt",
    ]);
  });

  it("strips EDGAR's inline-XBRL viewer prefix so both halves of the round trip agree", () => {
    expect(conversionCandidates("4", "0001-26-1", "xslF345X03/wf-form4.xml")[0]).toBe(
      "wf-form4.xml"
    );
  });

  it("still offers the full submission when the filing names no primary document", () => {
    expect(conversionCandidates("8-K", "0001-26-1", null)).toEqual(["0001-26-1.txt"]);
    expect(conversionCandidates("8-K", "0001-26-1", "  ")).toEqual(["0001-26-1.txt"]);
  });
});
