/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { RiskFactorRepo } from "../../../storage/risk-factor/RiskFactorRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const CATEGORY = "Risks Relating to our Securities";
const FIRST = "We may issue additional shares, which would dilute our stockholders.";
const SECOND = "There is currently no market for our securities.";

// Risk Factors is the only target section, so it is the only model call. The
// prose deliberately avoids blank-check language so the SPAC content classifier
// stays off (it would otherwise consume a scripted response).
const HTML =
  "<h1>RISK FACTORS</h1>" +
  `<h2>${CATEGORY}</h2>` +
  `<p><b>${FIRST}</b></p>` +
  "<p>Our charter authorizes the issuance of additional shares of common stock.</p>" +
  `<p><b>${SECOND}</b></p>` +
  "<p>Stockholders therefore have no access to information about prior market history.</p>";

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

const ACCESSION = "0000000000-26-000001";

async function runS1(): Promise<void> {
  await processFormS1({
    cik: 1018724,
    file_number: "333-1",
    accession_number: ACCESSION,
    filing_date: "2026-01-02",
    primary_doc: "s1.htm",
    form: "S-1",
    formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
    model: fakeS1Model(),
  });
}

let cleanup: (() => void) | undefined;

describe("processFormS1 risk factors", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("writes one row per risk caption, in document order", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        risks: [
          { headline: FIRST, category: CATEGORY, confidence: 0.9, source_span: FIRST },
          { headline: SECOND, category: CATEGORY, confidence: 0.8, source_span: SECOND },
        ],
      },
    ]);
    cleanup = unregister;

    await runS1();

    const rows = await new RiskFactorRepo().queryByAccession(ACCESSION);
    expect(rows.map((r) => r.risk_index)).toEqual([0, 1]);
    expect(rows.map((r) => r.headline)).toEqual([FIRST, SECOND]);
    expect(rows[0].category).toBe(CATEGORY);
    expect(rows[0].cik).toBe(1018724);
    const entry = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "risk-factors");
    expect(entry?.status ?? "resolved").toBe("resolved");
  });

  it("re-extraction replaces the previous filing's rows", async () => {
    const first = registerFakeStructuredProvider([
      {
        risks: [
          { headline: FIRST, category: CATEGORY, confidence: 0.9, source_span: FIRST },
          { headline: SECOND, category: CATEGORY, confidence: 0.9, source_span: SECOND },
        ],
      },
    ]);
    await runS1();
    first.unregister();

    const second = registerFakeStructuredProvider([
      { risks: [{ headline: SECOND, category: null, confidence: 0.9, source_span: SECOND }] },
    ]);
    cleanup = second.unregister;
    await runS1();

    const rows = await new RiskFactorRepo().queryByAccession(ACCESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0].headline).toBe(SECOND);
    expect(rows[0].category).toBeNull();
  });

  it("refuses a paraphrased caption whose text is not in the section", async () => {
    // The source_span verifies, but the headline is invented — the caption IS
    // the row, so a paraphrase must not be persisted.
    const { unregister } = registerFakeStructuredProvider([
      {
        risks: [
          {
            headline: "Investing in us is risky because of dilution and illiquidity.",
            category: CATEGORY,
            confidence: 0.95,
            source_span: FIRST,
          },
        ],
      },
    ]);
    cleanup = unregister;

    await runS1();

    expect(await new RiskFactorRepo().queryByAccession(ACCESSION)).toHaveLength(0);
    const entry = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "risk-factors");
    expect(entry?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
    expect(entry?.status).toBe("pending");
  });

  it("records MIXED_CAPTION_SHAPE and persists no rows for a mixed section", async () => {
    // One caption ends in a period and one does not. Neither shape can be
    // trusted as the discriminator, so the old all-or-nothing filter would have
    // kept the punctuated row alone and written it as the filing's complete
    // risk disclosure. Nothing is persisted and the section dead-letters.
    const { unregister } = registerFakeStructuredProvider([
      {
        risks: [
          { headline: CATEGORY, category: null, confidence: 0.9, source_span: CATEGORY },
          { headline: FIRST, category: CATEGORY, confidence: 0.9, source_span: FIRST },
        ],
      },
    ]);
    cleanup = unregister;

    await runS1();

    expect(await new RiskFactorRepo().queryByAccession(ACCESSION)).toHaveLength(0);
    const mixed = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "risk-factors");
    expect(mixed?.reason_code).toBe("MIXED_CAPTION_SHAPE");
    expect(mixed?.status).toBe("pending");
  });

  it("refuses an elided caption rather than storing its head as the whole thing", async () => {
    // The span verifies and the head is verbatim, so the only thing wrong is
    // that the caption stops early. Salvaging the head — right for a citation —
    // would persist a truncated sentence as the filer's complete disclosure,
    // with no marker, no dead letter and a resolved section.
    const { unregister } = registerFakeStructuredProvider([
      {
        risks: [
          {
            headline: `${FIRST.slice(0, 60)}\u2026 and other risks`,
            category: CATEGORY,
            confidence: 0.95,
            source_span: FIRST,
          },
        ],
      },
    ]);
    cleanup = unregister;

    await runS1();

    expect(await new RiskFactorRepo().queryByAccession(ACCESSION)).toHaveLength(0);
    const entry = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "risk-factors");
    expect(entry?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
    expect(entry?.status).toBe("pending");
  });

  it("stores a fully verbatim caption byte-for-byte", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        risks: [{ headline: FIRST, category: CATEGORY, confidence: 0.95, source_span: FIRST }],
      },
    ]);
    cleanup = unregister;

    await runS1();

    const rows = await new RiskFactorRepo().queryByAccession(ACCESSION);
    expect(rows).toHaveLength(1);
    expect(rows[0].headline).toBe(FIRST);
  });

  it("dead-letters SECTION_NOT_FOUND when the filing has no risk factors section", async () => {
    const { unregister } = registerFakeStructuredProvider([{ risks: [] }]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: ACCESSION,
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: "<h1>USE OF PROCEEDS</h1><p>We intend to repay debt.</p>",
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const entry = await new ExtractionDeadLetterRepo().get("S-1", ACCESSION, "risk-factors");
    expect(entry?.reason_code).toBe("SECTION_NOT_FOUND");
  });
});
