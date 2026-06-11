/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { processFormS1 } from "./Form_S_1.storage";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { UnderwriterLinkRepo } from "../../../storage/canonical/UnderwriterLinkRepo";
import { CanonicalUnderwriterFamilyRepo } from "../../../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { UnderwriterFamilyMembershipRepo } from "../../../storage/canonical/UnderwriterFamilyMembershipRepo";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML = "<h1>UNDERWRITING</h1><p>Goldman Sachs &amp; Co. LLC and GS Securities.</p>";
const NULL_HEADER = { sic: null, sicDescription: null, cik: null, companyName: null, filingDate: null };

let cleanup: (() => void) | undefined;

describe("processFormS1 underwriters", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("links two Goldman entities to one family and answers the headline query", async () => {
    // Sections present: Underwriting only. Call order: offering-terms (1st; reads
    // Underwriting text), then underwriters (2nd). Provide both payloads.
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: null, shares_offered: null, price: null, price_low: null, price_high: null,
        gross_proceeds: null, net_proceeds: null, over_allotment_shares: null, units_offered: null,
        price_per_unit: null, unit_composition: null, warrant_fraction_per_unit: null,
        right_fraction_per_unit: null, trust_per_unit: null, over_allotment_units: null,
        exchange: null, par_value: null, confidence: 0.5, source_span: "x", tickers: [],
      },
      {
        underwriters: [
          { legal_name: "Goldman Sachs & Co. LLC", common_name: "Goldman Sachs", role: "lead", shares_allocated: 3000000, over_allotment_shares: 450000, confidence: 0.95, source_span: "Goldman Sachs & Co. LLC" },
          { legal_name: "GS Securities LLC", common_name: "Goldman Sachs", role: "bookrunner", shares_allocated: 1000000, over_allotment_shares: null, confidence: 0.9, source_span: "GS Securities" },
        ],
      },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "0000000000-26-000001",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const companies = await new CompanyObservationRepo().listAll();
    expect(companies.some((c) => c.name === "Goldman Sachs & Co. LLC")).toBe(true);

    const family = await new CanonicalUnderwriterFamilyRepo().findByResolverAndName("1.0.0", "GOLDMAN SACHS");
    expect(family).toBeDefined();
    const members = await new UnderwriterFamilyMembershipRepo().listCompaniesForFamily(
      "1.0.0",
      family!.canonical_underwriter_family_id
    );
    expect(members.length).toBe(2);

    const ciks = await new UnderwriterLinkRepo().listIssuerCiksForFamily(
      family!.canonical_underwriter_family_id
    );
    expect(ciks).toEqual([1018724]);
  });
});
