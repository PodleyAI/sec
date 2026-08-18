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

  it("persists a parseable table as deterministic without calling the ownership model", async () => {
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
  });
});
