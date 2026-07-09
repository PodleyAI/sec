/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { processForm424 } from "./Form_424.storage";
import { processFormS1 } from "./Form_S_1.storage";

// No model is registered and none is passed via args, so getS1Model() throws.
// The processors must degrade gracefully — persist the deterministic work and
// dead-letter the AI sections — rather than aborting the whole filing.

const SPAC_CIK = 1821595;

const SPAC_HEADER = {
  sic: 6770,
  sicDescription: "BLANK CHECKS",
  cik: SPAC_CIK,
  companyName: "Test SPAC Corp",
  filingDate: null,
};

const MINIMAL_HTML = [
  "<h1>MANAGEMENT</h1><p>Jane Roe — Director</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1><p>None.</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1><p>None.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

describe("form processors degrade gracefully when the extractor model is unavailable", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("S-1: creates the SPAC registration row and dead-letters the AI sections (no throw)", async () => {
    await processFormS1({
      cik: SPAC_CIK,
      file_number: "333-1",
      accession_number: "0000000000-22-000001",
      filing_date: "2022-01-20",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: SPAC_HEADER,
        html: MINIMAL_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      // no `model` — forces getS1Model() to resolve against the empty repo
    });

    // Deterministic SPAC row still landed.
    const row = await new SpacRepo().getSpac(SPAC_CIK);
    expect(row?.status).toBe("registered");
    expect(row?.spac_sic).toBe(6770);
    expect(row?.registration_date).toBe("2022-01-20");

    // Every AI section is dead-lettered under MODEL_RESOLUTION_ERROR.
    const pending = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((d) => d.reason_code === "MODEL_RESOLUTION_ERROR")).toBe(true);
    const sections = new Set(pending.map((d) => d.section_name));
    expect(sections.has("spac-profile")).toBe(true);
    expect(sections.has("Management")).toBe(true);
  });

  it("priced 424B4: dead-letters the offering sections without aborting (no throw)", async () => {
    await processForm424({
      cik: SPAC_CIK,
      file_number: "333-1",
      accession_number: "0000000000-22-000002",
      filing_date: "2022-01-24",
      primary_doc: "424b4.htm",
      form: "424B4",
      form424: {
        header: SPAC_HEADER,
        html: MINIMAL_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      // no `model`
    });

    const pending = await new ExtractionDeadLetterRepo().listPending("424");
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((d) => d.reason_code === "MODEL_RESOLUTION_ERROR")).toBe(true);
  });
});
