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
import { processFormS1 } from "./Form_S_1.storage";
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

  it("persists a SPAC ownership table with no offered/after columns as deterministic", async () => {
    const { unregister } = registerFakeStructuredProvider([MANAGEMENT_PAYLOAD]);
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

    const rows = await new BeneficialOwnershipRepo().queryByAccession("acc-own-1");
    expect(rows.map((r) => [r.owner_kind, r.shares_owned])).toEqual([
      ["company", 4312500],
      ["person", 4312500],
    ]);
    const companies = await new CompanyObservationRepo().listAll();
    expect(companies.some((c) => /Halyard Sponsor/i.test(c.name ?? ""))).toBe(true);
    // The table prints one class, no offered/after columns and no selling
    // stockholders, so the six columns the parse hardcodes null are what this
    // filing actually discloses — nothing is lost by writing them.
    expect(rows[0]!.security_class).toBeNull();
    expect(rows[0]!.shares_after).toBeNull();
    expect(rows[0]!.is_selling_stockholder).toBe(false);
  });

  it("does not preempt the ownership model on a resale table with Shares Offered / Shares After columns", async () => {
    // The same parse, the same table shape, the opposite verdict: here the
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
