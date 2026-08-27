/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { conversionCandidates } from "./ConvertFilingDocumentTask";
import { convertFilingSubmission, filingDocumentTitle } from "./convertFilingDocument";

const HEADING = 'style="font-weight:700;text-align:center;font-size:14pt"';

const BARE_HTML = `<html><body>
  <p>Cover page of the offering.</p>
  <p ${HEADING}>RISK FACTORS</p>
  <p>Investing involves risk.</p>
  <p ${HEADING}>USE OF PROCEEDS</p>
  <p>We intend to use the proceeds.</p>
</body></html>`;

const doc = (type: string, seq: number, file: string, body: string, description?: string) =>
  `<DOCUMENT>
<TYPE>${type}
<SEQUENCE>${seq}
<FILENAME>${file}
${description === undefined ? "" : `<DESCRIPTION>${description}\n`}<TEXT>
${body}
</TEXT>
</DOCUMENT>`;

const submission = (...docs: string[]) => `<SEC-DOCUMENT>0001234567-26-000001.txt : 20260101
<SEC-HEADER>0001234567-26-000001.hdr.sgml : 20260101
COMPANY CONFORMED NAME: EXAMPLE ACQUISITION CORP
</SEC-HEADER>
${docs.join("\n")}
</SEC-DOCUMENT>`;

const FULL_SUBMISSION = submission(
  doc("S-1", 1, "example-s1.htm", BARE_HTML),
  doc(
    "EX-23.1",
    2,
    "ex231.htm",
    "<html><body><p>Consent of independent registered public accounting firm.</p></body></html>",
    "Consent of Marcum LLP"
  ),
  doc("GRAPHIC", 3, "logo.jpg", "\xff\xd8\xff\xe0 binary"),
  doc("EX-101.INS", 4, "ex101.xml", "<xbrl><context/></xbrl>")
);

const EIGHT_K = submission(
  doc("8-K", 1, "form8k.htm", `<html><body><p>Item 7.01. See Exhibit 99.1.</p></body></html>`),
  doc(
    "EX-99.1",
    2,
    "ex99-1.htm",
    `<html><body>
       <p ${HEADING}>PRESS RELEASE</p>
       <p>Example Acquisition Corp announced a business combination.</p>
     </body></html>`,
    "Press release dated March 3, 2026"
  )
);

describe("convertFilingSubmission", () => {
  it("converts a bare primary document into one document of ordered sections", () => {
    const [primary, ...rest] = convertFilingSubmission(
      "S-1",
      "0001234567-26-000001",
      BARE_HTML,
      "example-s1.htm"
    );
    expect(rest).toHaveLength(0);
    expect(primary.isPrimary).toBe(true);
    expect(primary.docFile).toBe("example-s1.htm");
    expect(primary.title).toBe("S-1 0001234567-26-000001");
    expect(primary.sections.map((s) => s.title)).toEqual([
      "S-1 0001234567-26-000001",
      "RISK FACTORS",
      "USE OF PROCEEDS",
    ]);
    expect(primary.sections.map((s) => s.slug)).toEqual([
      "s-1-0001234567-26-000001",
      "risk-factors",
      "use-of-proceeds",
    ]);
    expect(primary.sections[1].markdown).toContain("Investing involves risk.");
    expect(primary.charCount).toBe(primary.sections.reduce((sum, s) => sum + s.markdown.length, 0));
  });

  it("keeps the exhibits as their own documents rather than folding them into the body", () => {
    const docs = convertFilingSubmission(
      "S-1",
      "0001234567-26-000001",
      FULL_SUBMISSION,
      "example-s1.htm"
    );
    expect(docs.map((d) => d.docFile)).toEqual(["example-s1.htm", "ex231.htm"]);
    const body = docs[0].sections.map((s) => s.markdown).join("\n");
    expect(body).toContain("Investing involves risk.");
    expect(body).not.toContain("Consent of independent registered");
    // Nor may the SGML header lines reach the reader as prose.
    expect(body).not.toContain("COMPANY CONFORMED NAME");
    expect(docs[1].sections.map((s) => s.markdown).join("\n")).toContain(
      "Consent of independent registered"
    );
  });

  it("drops the members that are not prose", () => {
    const docs = convertFilingSubmission(
      "S-1",
      "0001234567-26-000001",
      FULL_SUBMISSION,
      "example-s1.htm"
    );
    // A JPEG and an XBRL instance are members of the submission but render to
    // noise, and a directory listing of noise is worse than an honest scope.
    expect(docs.map((d) => d.docFile)).not.toContain("logo.jpg");
    expect(docs.map((d) => d.docFile)).not.toContain("ex101.xml");
  });

  it("keeps the 8-K exhibit that carries the disclosure the primary only points at", () => {
    const docs = convertFilingSubmission("8-K", "0001234567-26-000001", EIGHT_K, "form8k.htm");
    expect(docs.map((d) => d.docFile)).toEqual(["form8k.htm", "ex99-1.htm"]);
    expect(docs[0].isPrimary).toBe(true);
    expect(docs[1].isPrimary).toBe(false);
    expect(docs[1].title).toBe("EX-99.1 Press release dated March 3, 2026");
    expect(docs[1].sections.map((s) => s.markdown).join("\n")).toContain(
      "announced a business combination"
    );
  });

  it("reads the primary identically whichever shape the cache holds", () => {
    const bare = convertFilingSubmission(
      "S-1",
      "0001234567-26-000001",
      BARE_HTML,
      "example-s1.htm"
    );
    const full = convertFilingSubmission(
      "S-1",
      "0001234567-26-000001",
      FULL_SUBMISSION,
      "example-s1.htm"
    );
    expect(full[0].sections.map((s) => s.markdown)).toEqual(
      bare[0].sections.map((s) => s.markdown)
    );
  });

  it("yields no documents for a submission with no prose in it", () => {
    expect(
      convertFilingSubmission("8-K", "0001-26-1", "<html><body></body></html>", "form8k.htm")
    ).toHaveLength(0);
  });

  it("orders the primary first, then by the submission's own sequence", () => {
    const outOfOrder = submission(
      doc("EX-99.2", 3, "ex99-2.htm", "<html><body><p>Second exhibit body.</p></body></html>"),
      doc("EX-99.1", 2, "ex99-1.htm", "<html><body><p>First exhibit body.</p></body></html>"),
      doc("8-K", 1, "form8k.htm", "<html><body><p>Primary body.</p></body></html>")
    );
    const docs = convertFilingSubmission("8-K", "0001-26-1", outOfOrder, "form8k.htm");
    expect(docs.map((d) => d.docFile)).toEqual(["form8k.htm", "ex99-1.htm", "ex99-2.htm"]);
  });
});

describe("filingDocumentTitle", () => {
  it("names a filing carrying no form rather than rendering an empty title", () => {
    expect(filingDocumentTitle(null, "0001-26-1")).toBe("Filing 0001-26-1");
    expect(filingDocumentTitle("   ", "0001-26-1")).toBe("Filing 0001-26-1");
  });

  it("names an exhibit by what EDGAR calls it and what the filer said it was", () => {
    const exhibit = { isPrimary: false, docType: "EX-99.1", description: "Press release" };
    expect(filingDocumentTitle("8-K", "0001-26-1", exhibit)).toBe("EX-99.1 Press release");
  });

  it("does not repeat a description that only restates the type", () => {
    // Plenty of filers set <DESCRIPTION>EX-99.1 and nothing more.
    const exhibit = { isPrimary: false, docType: "EX-99.1", description: "ex-99.1" };
    expect(filingDocumentTitle("8-K", "0001-26-1", exhibit)).toBe("EX-99.1");
  });

  it("falls back to the filing's own title when an exhibit declares neither", () => {
    const exhibit = { isPrimary: false, docType: null, description: null };
    expect(filingDocumentTitle("8-K", "0001-26-1", exhibit)).toBe("8-K 0001-26-1");
  });
});

describe("conversionCandidates", () => {
  it("prefers the full submission for every form, since it is the only shape carrying exhibits", () => {
    expect(conversionCandidates("S-1", "0001234567-26-000001", "example-s1.htm")).toEqual([
      "0001234567-26-000001.txt",
      "example-s1.htm",
    ]);
    expect(conversionCandidates("8-K", "0001234567-26-000001", "form8k.htm")).toEqual([
      "0001234567-26-000001.txt",
      "form8k.htm",
    ]);
  });

  it("strips EDGAR's inline-XBRL viewer prefix so both halves of the round trip agree", () => {
    expect(conversionCandidates("4", "0001-26-1", "xslF345X03/wf-form4.xml")).toEqual([
      "0001-26-1.txt",
      "wf-form4.xml",
    ]);
  });

  it("still offers the full submission when the filing names no primary document", () => {
    expect(conversionCandidates("8-K", "0001-26-1", null)).toEqual(["0001-26-1.txt"]);
    expect(conversionCandidates("8-K", "0001-26-1", "  ")).toEqual(["0001-26-1.txt"]);
  });
});
