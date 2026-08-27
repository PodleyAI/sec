/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { BeneficialOwnershipRepo } from "../../../storage/beneficial-ownership/BeneficialOwnershipRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { processFormS1 } from "./Form_S_1.storage";
import { S1_SECTIONS } from "../../html/sectionVocabulary";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import { parseBeneficialOwnership } from "./s1/parseBeneficialOwnership";
import { DETERMINISTIC_MODEL_ID } from "./s1/parseOfferingTables";
import { resolveModelId } from "./s1/s1Model";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML_PARSEABLE = [
  "<h1>MANAGEMENT</h1>",
  "<p>Eleanor Vasquez — Director</p>",
  "<h1>PRINCIPAL STOCKHOLDERS</h1>",
  "<table>",
  "<tr><td>Name and Address of Beneficial Owner</td><td>Number of Shares Beneficially Owned</td><td>Approximate Percentage</td></tr>",
  "<tr><td>Halyard Sponsor III LLC</td><td>4,312,500</td><td>100.0%</td></tr>",
  "<tr><td>Eleanor Vasquez</td><td>4,312,500</td><td>100.0%</td></tr>",
  "</table>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

// A resale registration's table: the columns the SPAC table above does not have.
const HTML_RESALE = [
  "<h1>MANAGEMENT</h1>",
  "<p>Eleanor Vasquez — Director</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1>",
  "<table>",
  "<tr><td>Name of Beneficial Owner</td><td>Class of Shares</td><td>Shares Beneficially Owned Before the Offering</td><td>Shares Offered</td><td>Shares Owned After the Offering</td><td>Percent After the Offering</td></tr>",
  "<tr><td>Halyard Sponsor III LLC</td><td>Class B</td><td>4,312,500</td><td>1,000,000</td><td>3,312,500</td><td>60.0%</td></tr>",
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
      full_name: "Eleanor Vasquez",
      titles: ["Director"],
      relationship: null,
      confidence: 0.9,
      source_span: "Eleanor Vasquez — Director",
    },
  ],
};

const SPAC_OWNERS_PAYLOAD = {
  owners: [
    {
      name: "Halyard Sponsor III LLC",
      owner_kind: "company",
      security_class: null,
      shares_owned: 4312500,
      percent_owned: 100,
      shares_offered: null,
      shares_after: null,
      percent_after: null,
      is_selling_stockholder: false,
      footnote: null,
      confidence: 0.9,
      source_span: "Halyard Sponsor III LLC",
    },
    {
      name: "Eleanor Vasquez",
      owner_kind: "person",
      security_class: null,
      shares_owned: 4312500,
      percent_owned: 100,
      shares_offered: null,
      shares_after: null,
      percent_after: null,
      is_selling_stockholder: false,
      footnote: null,
      confidence: 0.9,
      source_span: "Eleanor Vasquez",
    },
  ],
};

function ownershipSectionText(html: string): string {
  const segmented = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "s1.htm"));
  return segmented.find((s) => s.name === S1_SECTIONS.BENEFICIAL_OWNERSHIP)?.text ?? "";
}

let cleanup: (() => void) | undefined;

describe("processFormS1 beneficial ownership", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  // The table walk covers every column this table prints — a SPAC's pre-IPO
  // table states one class and no offered/after position, so the six columns
  // the parse hardcodes null are the disclosure — and it still does not stand
  // in for the model. `ownershipCoverage` answers the COLUMN question only; the
  // walk drops a stub failing `looksLikeOwner` and truncates one carrying a
  // street number, so it cannot report that these two are the whole roster, and
  // `beneficial_ownership` is cleared before persist. This filing is the case
  // that makes the rule visible: the parse reads the table outright and the
  // model runs anyway.
  it("sends a fully covered SPAC ownership table to the model, because the walk cannot claim it read every row", async () => {
    expect(
      parseBeneficialOwnership(ownershipSectionText(HTML_PARSEABLE)).map((r) => [
        r.owner_kind,
        r.shares_owned,
      ])
    ).toEqual([
      ["company", 4312500],
      ["person", 4312500],
    ]);

    const { calls, unregister } = registerFakeStructuredProvider([
      MANAGEMENT_PAYLOAD,
      SPAC_OWNERS_PAYLOAD,
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "acc-own-1",
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

    expect(calls.some((p) => /Extract every beneficial owner/.test(p))).toBe(true);

    const rows = await new BeneficialOwnershipRepo().queryByAccession("acc-own-1");
    expect(rows.map((r) => [r.owner_kind, r.shares_owned])).toEqual([
      ["company", 4312500],
      ["person", 4312500],
    ]);
    const companies = await new CompanyObservationRepo().listAll();
    expect(companies.some((c) => /Halyard Sponsor/i.test(c.name ?? ""))).toBe(true);
    expect(rows[0]!.security_class).toBeNull();
    expect(rows[0]!.shares_after).toBeNull();
    expect(rows[0]!.is_selling_stockholder).toBe(false);
    // The rows are the model's, not the walk's, and provenance says so.
    const provenance = await new ObservationProvenanceRepo().get(
      "company",
      rows[0]!.observation_id!
    );
    expect(provenance?.model_id).not.toBe(DETERMINISTIC_MODEL_ID);
    expect(provenance?.model_id).toBe(resolveModelId(fakeS1Model()));
  });

  it("persists the class / offered / after figures a resale table states, which the walk would have written null", async () => {
    // The row half above already sends every ownership section to the model, so
    // this filing gets there for a second, independent reason: `ownershipCoverage`
    // declines the column half outright, and the walk never even runs. Here the
    // filing DOES state a class, an offered count and an after-offering
    // position, so the parse's hardcoded nulls would delete three disclosed
    // figures — and `is_selling_stockholder: false` would assert this holder
    // registers no resale, which is the opposite of what the section says.
    const { unregister } = registerFakeStructuredProvider([
      MANAGEMENT_PAYLOAD,
      {
        owners: [
          {
            name: "Halyard Sponsor III LLC",
            owner_kind: "company",
            security_class: "Class B",
            shares_owned: 4312500,
            percent_owned: 100,
            shares_offered: 1000000,
            shares_after: 3312500,
            percent_after: 60,
            is_selling_stockholder: true,
            footnote: null,
            confidence: 0.9,
            source_span: "Halyard Sponsor III LLC",
          },
        ],
      },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-2",
      accession_number: "acc-own-2",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: HTML_RESALE,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const rows = await new BeneficialOwnershipRepo().queryByAccession("acc-own-2");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.security_class).toBe("Class B");
    expect(rows[0]!.shares_offered).toBe(1000000);
    expect(rows[0]!.shares_after).toBe(3312500);
    expect(rows[0]!.is_selling_stockholder).toBe(true);
  });
});
