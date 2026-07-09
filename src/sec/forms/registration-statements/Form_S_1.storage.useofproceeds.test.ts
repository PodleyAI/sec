/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { UseOfProceedsRepo } from "../../../storage/use-of-proceeds/UseOfProceedsRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML =
  "<h1>USE OF PROCEEDS</h1>" +
  "<p>We intend to use net proceeds to repay debt and for working capital.</p>";
const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

let cleanup: (() => void) | undefined;

describe("processFormS1 use of proceeds", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("writes use-of-proceeds line items", async () => {
    // Sections present: Use of Proceeds only. The Offering / Underwriting absent
    // (offering-terms + underwriters dead-letter SECTION_NOT_FOUND, no model call).
    // So the FIRST model call is use-of-proceeds.
    const { unregister } = registerFakeStructuredProvider([
      {
        line_items: [
          {
            purpose: "repay debt",
            amount: 20000000,
            percent: 40,
            note: null,
            confidence: 0.8,
            source_span: "repay debt",
          },
          {
            purpose: "working capital",
            amount: null,
            percent: null,
            note: "remainder",
            confidence: 0.6,
            source_span: "working capital",
          },
        ],
      },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "0000000000-26-000001",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const rows = await new UseOfProceedsRepo().queryByAccession("0000000000-26-000001");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.purpose === "repay debt")?.amount).toBe(20000000);
  });
});
