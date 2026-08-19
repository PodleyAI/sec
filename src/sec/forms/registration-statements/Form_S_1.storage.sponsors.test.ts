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
  "<h1>MANAGEMENT</h1><p>x</p>",
  "<h1>THE SPONSOR</h1>",
  "<p>Our sponsor, Acme Sponsor LLC, is a Delaware limited liability company and was formed to invest in us.</p>",
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

describe("processFormS1 spac-sponsors", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("persists a parseable sponsor sentence as deterministic without calling the sponsor model", async () => {
    const { calls, unregister } = registerFakeStructuredProvider([
      {
        focus: [],
        focus_location: [],
        description: null,
        team: null,
        url_spac: null,
        confidence: 0.9,
        source_span: "Our sponsor, Acme Sponsor LLC, is a Delaware limited liability company",
      },
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "acc-spn-1",
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

    const companies = (await new CompanyObservationRepo().listAll()).filter((c) =>
      /s1:spac-sponsor/.test(c.source_context ?? "")
    );
    expect(companies.some((c) => /Acme Sponsor/i.test(c.name ?? ""))).toBe(true);
    expect(calls.some((p) => /Identify each sponsor entity/.test(p))).toBe(false);
    const party = companies.find((c) => /Acme Sponsor/i.test(c.name ?? ""));
    const provenance = await new ObservationProvenanceRepo().get("company", party!.observation_id);
    expect(provenance?.model_id).toBe(DETERMINISTIC_MODEL_ID);
  });
});
