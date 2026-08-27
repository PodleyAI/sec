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
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { processFormS1 } from "./Form_S_1.storage";
import { S1_SECTIONS } from "../../html/sectionVocabulary";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import { DETERMINISTIC_MODEL_ID } from "./s1/parseOfferingTables";
import { parseSpacSponsors } from "./s1/parseSpacSponsors";
import { resolveModelId } from "./s1/s1Model";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const SPONSOR_SENTENCE =
  "Our sponsor, Acme Sponsor LLC, is a Delaware limited liability company and was formed to invest in us.";

const HTML_PARSEABLE = [
  "<h1>MANAGEMENT</h1><p>x</p>",
  "<h1>THE SPONSOR</h1>",
  `<p>${SPONSOR_SENTENCE}</p>`,
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const HEADER_6770 = {
  sic: 6770,
  sicDescription: "BLANK CHECKS",
  cik: null,
  companyName: null,
  filingDate: null,
};

const SPONSOR_SPAN = "Our sponsor, Acme Sponsor LLC, is a Delaware limited liability company";

function sponsorSectionText(html: string): string {
  const segmented = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "s1.htm"));
  return segmented.find((s) => s.name === S1_SECTIONS.THE_SPONSOR)?.text ?? "";
}

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

  // The sponsor pass is two prose patterns, both requiring `our|the` immediately
  // before `sponsor`. Reading THIS sentence says nothing about whether the
  // section introduced a second sponsor some other way ("our co-sponsor, Beta
  // Holdings LLC, is …"), and `spac_sponsor_link` is cleared before persist — so
  // the pass declares no completeness and never stands in for the model, however
  // cleanly it reads the prose. This filing is the case that makes the rule
  // visible: the parse handles the sentence outright and the model runs anyway.
  it("sends a parseable sponsor sentence to the model, because the prose parse cannot claim the section named no one else", async () => {
    expect(parseSpacSponsors(sponsorSectionText(HTML_PARSEABLE)).map((r) => r.legal_name)).toEqual([
      "Acme Sponsor LLC",
    ]);

    const { calls, unregister } = registerFakeStructuredProvider([
      {
        focus: [],
        focus_location: [],
        description: null,
        team: null,
        url_spac: null,
        confidence: 0.9,
        source_span: SPONSOR_SPAN,
      },
      { people: [] },
      { owners: [] },
      { parties: [] },
      {
        sponsors: [{ legal_name: "Acme Sponsor LLC", confidence: 0.9, source_span: SPONSOR_SPAN }],
      },
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

    expect(calls.some((p) => /Identify each sponsor entity/.test(p))).toBe(true);

    const companies = (await new CompanyObservationRepo().listAll()).filter((c) =>
      /s1:spac-sponsor/.test(c.source_context ?? "")
    );
    expect(companies.some((c) => /Acme Sponsor/i.test(c.name ?? ""))).toBe(true);
    const party = companies.find((c) => /Acme Sponsor/i.test(c.name ?? ""));
    const provenance = await new ObservationProvenanceRepo().get("company", party!.observation_id);
    expect(provenance?.model_id).not.toBe(DETERMINISTIC_MODEL_ID);
    expect(provenance?.model_id).toBe(resolveModelId(fakeS1Model()));
  });
});
