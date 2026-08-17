/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { selectRegACoverDocument, selectRegAReportDocument } from "./regAReportDocument";

const doc = (type: string, fileName: string, body: string): string =>
  `<DOCUMENT>\n<TYPE>${type}\n<SEQUENCE>1\n<FILENAME>${fileName}\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n`;

const submission = (...documents: string[]): string =>
  `<SEC-DOCUMENT>\n<SEC-HEADER>\n</SEC-HEADER>\n${documents.join("")}</SEC-DOCUMENT>`;

describe("selectRegAReportDocument", () => {
  it("takes the 1-K's PART II, not its primary_doc.xml", () => {
    // This is the whole point. The pipeline fetches each filing's PRIMARY
    // document, which for a 1-K is the XSD-tagged cover page — and that XSD has
    // no financial elements, which is why 1-K produced 0 financial rows across
    // all 2,997 filings. The annual report is a separate document in the same
    // submission.
    const text = submission(
      doc("1-K", "primary_doc.xml", "<edgarSubmission>cover page</edgarSubmission>"),
      doc("PART II", "sixdbytes_1k.htm", "<html>Total Assets</html>")
    );
    expect(selectRegAReportDocument(text, "1-K")).toEqual({
      fileName: "sixdbytes_1k.htm",
      body: "<html>Total Assets</html>",
    });
  });

  it("takes PART II even when an exhibit is the first HTML in the submission", () => {
    // Frontieras files `exhibit_6-2c.htm` ahead of its annual report, so both
    // "first HTML document" and any filename heuristic pick a material contract.
    // The SGML <TYPE> is assigned from the filer's submission header and is the
    // one reliable discriminator.
    const text = submission(
      doc("1-K", "primary_doc.xml", "<edgarSubmission/>"),
      doc("EX1K-6 MAT CTRCT", "exhibit_6-2c.htm", "<html>a contract</html>"),
      doc("PART II", "e6015_1-k_2025_fast.htm", "<html>Total Assets</html>")
    );
    expect(selectRegAReportDocument(text, "1-K")?.fileName).toBe("e6015_1-k_2025_fast.htm");
  });

  it("takes the 1-SA's own document", () => {
    const text = submission(
      doc("1-SA", "tm2425224d1_1sa.htm", "<html>Total Assets</html>"),
      doc("GRAPHIC", "logo.jpg", "<PDF>binary</PDF>")
    );
    expect(selectRegAReportDocument(text, "1-SA")?.fileName).toBe("tm2425224d1_1sa.htm");
  });

  it("resolves an amendment to its base form's document type", () => {
    // An amended annual report is still a PART II.
    const text = submission(doc("PART II", "amended.htm", "<html>Total Assets</html>"));
    expect(selectRegAReportDocument(text, "1-K/A")?.fileName).toBe("amended.htm");
    expect(selectRegAReportDocument(text, "1-k")?.fileName).toBe("amended.htm");
  });

  it("returns nothing for a form that carries no financial statements", () => {
    const text = submission(doc("PART II", "report.htm", "<html>Total Assets</html>"));
    expect(selectRegAReportDocument(text, "1-A")).toBeUndefined();
    expect(selectRegAReportDocument(text, "1-U")).toBeUndefined();
  });

  it("returns nothing when the submission has no such document", () => {
    // A filing may legitimately incorporate its financials by reference, so the
    // caller treats this as "nothing to extract" rather than as an error.
    const text = submission(doc("1-K", "primary_doc.xml", "<edgarSubmission/>"));
    expect(selectRegAReportDocument(text, "1-K")).toBeUndefined();
  });

  it("strips EDGAR's <XML> envelope so edgarSubmission is the root", () => {
    // The public `<accession>.txt` wraps an XML member's body in <XML>…</XML>;
    // the `.nc` feed the bulk cache is built from does not. Left in place, <XML>
    // becomes the root and `json.edgarSubmission` is silently undefined — the
    // filing parses to nothing with no error anywhere.
    const wrapped = submission(
      doc("1-K", "primary_doc.xml", "<XML>\n<?xml version=\"1.0\"?>\n<edgarSubmission/>\n</XML>")
    );
    expect(selectRegACoverDocument(wrapped, "1-K")?.body).toBe(
      '<?xml version="1.0"?>\n<edgarSubmission/>'
    );

    // The unwrapped `.nc` form must pass through untouched.
    const bare = submission(doc("1-K", "primary_doc.xml", "<edgarSubmission/>"));
    expect(selectRegACoverDocument(bare, "1-K")?.body).toBe("<edgarSubmission/>");
  });

  it("refuses a binary member rather than returning its SGML wrapper", () => {
    // A scanned-PDF annual report has no parseable tables; handing back the
    // wrapper would look like a document and parse to nothing.
    const pdf = submission(doc("PART II", "scanned.pdf", "<PDF>\nJVBERi0xLjQ=\n</PDF>"));
    expect(selectRegAReportDocument(pdf, "1-K")).toBeUndefined();

    const uu = submission(doc("PART II", "scanned.pdf", "begin 644 report.pdf\nM(0"));
    expect(selectRegAReportDocument(uu, "1-K")).toBeUndefined();
  });
});
