/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML_PARSEABLE = [
  "<h1>PROSPECTUS SUMMARY</h1>",
  "<p>Although we may pursue targets in any industry, we intend to initially focus our search on identifying a prospective target business in healthcare and biopharmaceuticals.</p>",
  "<h1>MANAGEMENT</h1><p>x</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const HEADER_6770 = {
  sic: 6770,
  sicDescription: "BLANK CHECKS",
  cik: null,
  companyName: null,
  filingDate: null,
};

let cleanup: (() => void) | undefined;

describe("processFormS1 spac-profile", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("persists a parseable focus sentence as deterministic without calling the profile model", async () => {
    const { calls, unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "acc-prf-1",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: HEADER_6770,
        html: HTML_PARSEABLE,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const spac = await new SpacRepo().getSpac(1018724);
    expect(JSON.parse(spac?.focus ?? "[]")).toEqual(["Healthcare", "Biopharmaceuticals"]);
    expect(calls.some((p) => /Extract the SPAC's acquisition profile/.test(p))).toBe(false);
  });
});
