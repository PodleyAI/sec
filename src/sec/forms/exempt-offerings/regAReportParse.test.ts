/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Form_1_K } from "./Form_1_K";
import { selectRegAReportDocument } from "./regAReportDocument";

const fixture = (name: string): string =>
  readFileSync(join(__dirname, "mock_data", "rega-financials", name), "utf-8");

const coverDocument = (): string => fixture("1k-cover-1800055-000121390024095260.sgml");

const reportDocument = (type: string, fileName: string, body: string): string =>
  `<DOCUMENT>\n<TYPE>${type}\n<SEQUENCE>2\n<FILENAME>${fileName}\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n`;

/**
 * Reconstitutes the two-document submission a real 1-K is, from the committed
 * halves — the actual `primary_doc.xml` with its SGML envelope, and the actual
 * PART II annual report. Both come from CIK 1800055, accession
 * 0001213900-24-095260.
 */
const fullSubmission1K = (extraDocuments = ""): string =>
  `<SEC-DOCUMENT>0001213900-24-095260.txt : 20240430\n<SEC-HEADER>\nCONFORMED SUBMISSION TYPE:\t1-K\n</SEC-HEADER>\n` +
  coverDocument() +
  extraDocuments +
  reportDocument(
    "PART II",
    "ea0219991-1k_caltier.htm",
    fixture("1k-partii-1800055-000121390024095260.htm")
  ) +
  `</SEC-DOCUMENT>`;

describe("Form_1_K.parse", () => {
  it("reads the cover page out of the submission", async () => {
    const parsed = await Form_1_K.parse("1-K", fullSubmission1K());

    expect(parsed.cover.headerData.submissionType).toBe("1-K");
    expect(parsed.cover.formData.item1Info[0]?.issuerName).toBe("CalTier Inc.");
    expect(parsed.cover.formData.item1Info[0]?.cik).toBe("0001800055");
  });

  it("still parses a bare primary_doc.xml", async () => {
    // A caller holding only the cover — a fixture, or a document cached before
    // the fetch was escalated — must not throw.
    const coverXml = coverDocument()
      .replace(/^[\s\S]*?<TEXT>\s*<XML>/i, "")
      .replace(/<\/XML>[\s\S]*$/i, "");
    const parsed = await Form_1_K.parse("1-K", coverXml);
    expect(parsed.cover.formData.item1Info[0]?.issuerName).toBe("CalTier Inc.");
  });

  it("keeps the cover when the submission carries no PART II", async () => {
    // A filing may incorporate its financials by reference. The cover data is
    // still worth storing, so a missing report degrades rather than throwing —
    // here, and in whatever goes looking for that report document.
    const submission = `<SEC-DOCUMENT>\n${coverDocument()}</SEC-DOCUMENT>`;
    const parsed = await Form_1_K.parse("1-K", submission);
    expect(parsed.cover.formData.item1Info[0]?.issuerName).toBe("CalTier Inc.");
    expect(selectRegAReportDocument(submission, "1-K")).toBeUndefined();
  });

  it("rejects a submission with no cover document", async () => {
    // Unlike a missing PART II, a missing cover means the filing cannot be
    // attributed at all — there is no issuer, no reporting period. That is a
    // parse failure, and the dead-letter path should see it.
    const noCover = `<SEC-DOCUMENT>\n${reportDocument("PART II", "report.htm", "<html>x</html>")}</SEC-DOCUMENT>`;
    await expect(Form_1_K.parse("1-K", noCover)).rejects.toThrow(/cover document/i);
  });

  it("refuses a form it does not handle", async () => {
    await expect(Form_1_K.parse("1-SA" as never, fullSubmission1K())).rejects.toThrow(
      /Invalid form/
    );
  });
});

describe("selectRegAReportDocument — PART II selection", () => {
  // The 1-K's annual report is a SIBLING document of the cover page, and which
  // one it is is the selector's answer, not the parser's. These assertions used
  // to be made through `Form_1_K.parse().statements`; the scan they reached
  // through is no longer in this package, so they are made at the selector
  // instead — the same behaviour, observed where it now lives.

  it("finds the PART II annual report in the submission", () => {
    const report = selectRegAReportDocument(fullSubmission1K(), "1-K");
    expect(report?.fileName).toBe("ea0219991-1k_caltier.htm");
    expect(report?.body).toContain("Total assets");
  });

  it("finds PART II past an exhibit filed ahead of it", () => {
    // Frontieras files `exhibit_6-2c.htm` before its annual report, so both
    // document order and any filename heuristic pick a material contract.
    const report = selectRegAReportDocument(
      fullSubmission1K(
        reportDocument(
          "EX1K-6 MAT CTRCT",
          "exhibit_6-2c.htm",
          "<html><body>A contract.</body></html>"
        )
      ),
      "1-K"
    );
    expect(report?.fileName).toBe("ea0219991-1k_caltier.htm");
    expect(report?.body).not.toContain("A contract.");
  });
});
