/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { S1ClassificationRepo } from "../../../storage/classification/S1ClassificationRepo";
import { processFormS1 } from "./Form_S_1.storage";
import {
  s1ModelsWithWalk,
  registerFakeStructuredProvider,
} from "./s1/testing/fakeStructuredProvider";

const HTML_PARSEABLE = [
  "<h1>PROSPECTUS SUMMARY</h1>",
  "<p>Acme Acquisition Corp. is a newly organized blank check company formed for the purpose of effecting a merger, share exchange, asset acquisition or similar business combination with one or more businesses. We have not selected any specific business combination target. Proceeds will be held in a trust account. Our sponsor will hold founder shares. Public shareholders may redeem their public shares.</p>",
  "<h1>MANAGEMENT</h1><p>x</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const HEADER_MISC = {
  sic: 7372,
  sicDescription: "PREPACKAGED SOFTWARE",
  cik: null,
  companyName: null,
  filingDate: null,
};

let cleanup: (() => void) | undefined;

describe("processFormS1 spac-classification", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("upgrades a miscoded blank-check summary as deterministic without calling the classifier model", async () => {
    const { calls, unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "acc-cls-1",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: HEADER_MISC,
        html: HTML_PARSEABLE,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      models: s1ModelsWithWalk(),
    });

    const row = await new S1ClassificationRepo().get("S-1", "acc-cls-1");
    expect(row?.is_spac).toBe(true);
    expect(row?.classifier_source).toBe("deterministic");
    expect(calls.some((p) => /Classify what KIND of issuer/.test(p))).toBe(false);
  });
});
