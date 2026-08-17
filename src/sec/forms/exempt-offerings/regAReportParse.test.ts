/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Form_1_K } from "./Form_1_K";
import { Form_1_SA } from "./Form_1_SA";

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
  it("reads the cover page AND the PART II statements from one submission", async () => {
    // The point of escalating the 1-K fetch to the full `.txt`. The cover is
    // `primary_doc.xml`, whose XSD has no financial elements at all — which is
    // why 1-K produced 0 financial rows across all 2,997 filings — and the
    // annual report is a sibling document.
    const parsed = await Form_1_K.parse("1-K", fullSubmission1K());

    expect(parsed.cover.headerData.submissionType).toBe("1-K");
    expect(parsed.cover.formData.item1Info[0]?.issuerName).toBe("CalTier Inc.");
    expect(parsed.cover.formData.item1Info[0]?.cik).toBe("0001800055");

    expect(parsed.statements.map((s) => s.kind)).toEqual([
      "balance_sheet",
      "operations",
      "cash_flows",
    ]);
    const balanceSheet = parsed.statements[0];
    expect(balanceSheet.periods).toEqual(["2023", "2022"]);
    expect(balanceSheet.rows.find((r) => r.label === "Total assets")?.values).toEqual([
      1491657, 1038273,
    ]);
  });

  it("finds PART II past an exhibit filed ahead of it", async () => {
    // Frontieras files `exhibit_6-2c.htm` before its annual report, so both
    // document order and any filename heuristic pick a material contract.
    const parsed = await Form_1_K.parse(
      "1-K",
      fullSubmission1K(
        reportDocument(
          "EX1K-6 MAT CTRCT",
          "exhibit_6-2c.htm",
          "<html><body>A contract.</body></html>"
        )
      )
    );
    expect(parsed.cover.formData.item1Info[0]?.issuerName).toBe("CalTier Inc.");
    expect(parsed.statements).toHaveLength(3);
  });

  it("still parses a bare primary_doc.xml, yielding no statements", async () => {
    // A caller holding only the cover — a fixture, or a document cached before
    // the fetch was escalated — must not throw. It simply has no statements.
    const coverXml = coverDocument()
      .replace(/^[\s\S]*?<TEXT>\s*<XML>/i, "")
      .replace(/<\/XML>[\s\S]*$/i, "");
    const parsed = await Form_1_K.parse("1-K", coverXml);
    expect(parsed.cover.formData.item1Info[0]?.issuerName).toBe("CalTier Inc.");
    expect(parsed.statements).toEqual([]);
  });

  it("keeps the cover when the submission carries no PART II", async () => {
    // A filing may incorporate its financials by reference. The cover data is
    // still worth storing, so this degrades rather than throwing.
    const parsed = await Form_1_K.parse("1-K", `<SEC-DOCUMENT>\n${coverDocument()}</SEC-DOCUMENT>`);
    expect(parsed.cover.formData.item1Info[0]?.issuerName).toBe("CalTier Inc.");
    expect(parsed.statements).toEqual([]);
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

describe("Form_1_SA.parse", () => {
  const fullSubmission1SA = (extraDocuments = ""): string =>
    `<SEC-DOCUMENT>\n<SEC-HEADER>\nCONFORMED SUBMISSION TYPE:\t1-SA\n</SEC-HEADER>\n` +
    extraDocuments +
    reportDocument("1-SA", "tm2425224d1_1sa.htm", fixture("1sa-1838432-000110465924104481.htm")) +
    `</SEC-DOCUMENT>`;

  it("reads the statements out of the submission", async () => {
    const parsed = await Form_1_SA.parse("1-SA", fullSubmission1SA());
    expect(parsed.statements.map((s) => s.kind)).toEqual([
      "balance_sheet",
      "operations",
      "cash_flows",
    ]);

    const balanceSheet = parsed.statements[0];
    expect(balanceSheet.periods).toEqual(["June 30, 2024", "December 31, 2023"]);
    expect(balanceSheet.rows.find((r) => r.label === "Total Assets")?.values).toEqual([
      2212204, 2789143,
    ]);
    // Every statement in a 1-SA is unaudited, including those whose own table
    // does not say so.
    expect(parsed.statements.every((s) => s.unaudited)).toBe(true);
  });

  it("finds the report past an exhibit filed ahead of it", async () => {
    const parsed = await Form_1_SA.parse(
      "1-SA",
      fullSubmission1SA(
        reportDocument("EX1SA-6 MAT CTRCT", "ex6.htm", "<html><body>A contract.</body></html>")
      )
    );
    expect(parsed.statements).toHaveLength(3);
  });

  it("parses the primary document, which is how the pipeline calls it", async () => {
    // A 1-SA's primary document IS its report — all 2,792 filings record a
    // `.htm` primary doc — so this, not the full submission, is the real path.
    // The form is deliberately excluded from REGA_FULL_SUBMISSION_FORMS.
    const parsed = await Form_1_SA.parse("1-SA", fixture("1sa-1838432-000110465924104481.htm"));
    expect(parsed.statements).toHaveLength(3);
  });

  it("returns no statements rather than throwing when the report is absent", async () => {
    // Nothing to extract is a clean outcome, not a failure: the run records a
    // success and the storage layer declines to treat 0 rows as a purge.
    const parsed = await Form_1_SA.parse(
      "1-SA",
      `<SEC-DOCUMENT>\n${reportDocument("GRAPHIC", "logo.jpg", "<PDF>x</PDF>")}</SEC-DOCUMENT>`
    );
    expect(parsed.statements).toEqual([]);
  });

  it("refuses a form it does not handle", async () => {
    await expect(Form_1_SA.parse("1-K" as never, fullSubmission1SA())).rejects.toThrow(
      /Invalid form/
    );
  });
});
