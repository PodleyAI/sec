/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { DETERMINISTIC_MODEL_ID } from "./s1/parseOfferingTables";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML_PARSEABLE = [
  "<h1>MANAGEMENT</h1>",
  "<p>Jane Roe — Director</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1>",
  "<table>",
  "<tr><td>Convertible Note Purchasers</td><td>Original Principal Amount</td></tr>",
  "<tr><td>Stellantis Ventures B.V.</td><td>$5,000,000</td></tr>",
  "</table>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

const MANAGEMENT_PAYLOAD = {
  people: [
    {
      full_name: "Jane Roe",
      titles: ["Director"],
      relationship: null,
      confidence: 0.9,
      source_span: "Jane Roe — Director",
    },
  ],
};

let cleanup: (() => void) | undefined;

describe("processFormS1 related-party tables", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("persists a parseable party table as deterministic without calling the related-party model", async () => {
    const { calls, unregister } = registerFakeStructuredProvider([MANAGEMENT_PAYLOAD]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "acc-rp-1",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: HTML_PARSEABLE,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const companies = await new CompanyObservationRepo().listAll();
    expect(companies.some((c) => /Stellantis Ventures/i.test(c.name ?? ""))).toBe(true);
    expect(calls.some((p) => /Extract related parties/.test(p))).toBe(false);
    const party = companies.find((c) => /Stellantis Ventures/i.test(c.name ?? ""));
    const provenance = await new ObservationProvenanceRepo().get("company", party!.observation_id);
    expect(provenance?.model_id).toBe(DETERMINISTIC_MODEL_ID);
  });
});
