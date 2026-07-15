/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { S1ClassificationRepo } from "../../../storage/classification/S1ClassificationRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

// A Prospectus Summary section with dense blank-check vocabulary (trips the
// content heuristic) so the AI classifier runs.
const BLANK_CHECK_SUMMARY_HTML = [
  "<h1>PROSPECTUS SUMMARY</h1>",
  "<p>We are a blank check company incorporated as a Cayman Islands exempted company " +
    "for the purpose of effecting an initial business combination. A total of $200,000,000 " +
    "will be deposited into the trust account for the benefit of our public shareholders. " +
    "Our sponsor holds founder shares.</p>",
].join("");

// An ordinary operating-company summary — no blank-check vocabulary, so the
// heuristic never fires and no AI classification call is made.
const OPERATING_SUMMARY_HTML = [
  "<h1>PROSPECTUS SUMMARY</h1>",
  "<p>We design and manufacture industrial pumps for the energy sector. We have been " +
    "profitable since 2019 and operate three factories.</p>",
].join("");

// A non-6770 (miscoded-eligible) SIC so the deterministic path yields is_spac=false.
const MISCODED_HEADER = {
  sic: 6199,
  sicDescription: "FINANCE SERVICES",
  cik: 1900001,
  companyName: "Nebula Capital Corp",
  filingDate: "20260102",
};

let cleanup: (() => void) | undefined;

describe("processFormS1 AI SPAC classifier", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("upgrades a SIC-miscoded blank-check filing to a known SPAC via the ai seam", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { is_spac: true, entity_kind: "spac", confidence: 0.95, source_span: "blank check company" },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1900001,
      file_number: "333-9",
      accession_number: "0000000000-26-000009",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: MISCODED_HEADER,
        html: BLANK_CHECK_SUMMARY_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const cls = await new S1ClassificationRepo().get("S-1", "0000000000-26-000009");
    expect(cls?.is_spac).toBe(true);
    expect(cls?.classifier_source).toBe("ai");
    // The upgrade mints a known-SPAC row so de-SPAC lifecycle extractors can attach.
    expect(await new SpacRepo().getSpac(1900001)).toBeDefined();
  });

  it("leaves a blank-check-looking filing unclassified when the model says not-a-SPAC", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { is_spac: false, entity_kind: "operating", confidence: 0.9, source_span: null },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1900002,
      file_number: "333-10",
      accession_number: "0000000000-26-000010",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: { ...MISCODED_HEADER, cik: 1900002 },
        html: BLANK_CHECK_SUMMARY_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const cls = await new S1ClassificationRepo().get("S-1", "0000000000-26-000010");
    expect(cls?.is_spac).toBe(false);
    // Not upgraded: the deterministic source stands, and no SPAC row is minted.
    expect(cls?.classifier_source).toBe("sgml-header");
    expect(await new SpacRepo().getSpac(1900002)).toBeUndefined();
  });

  it("never invokes the classifier for a non-blank-check operating-company S-1", async () => {
    const provider = registerFakeStructuredProvider([
      { is_spac: true, entity_kind: "spac", confidence: 0.99, source_span: "blank check company" },
    ]);
    cleanup = provider.unregister;

    await processFormS1({
      cik: 1900003,
      file_number: "333-11",
      accession_number: "0000000000-26-000011",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: { ...MISCODED_HEADER, cik: 1900003 },
        html: OPERATING_SUMMARY_HTML,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    // Heuristic never tripped → no classification model call, no upgrade.
    expect(provider.calls.length).toBe(0);
    const cls = await new S1ClassificationRepo().get("S-1", "0000000000-26-000011");
    expect(cls?.is_spac).toBe(false);
    expect(await new SpacRepo().getSpac(1900003)).toBeUndefined();
  });
});
