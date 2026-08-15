/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CanonicalUnderwriterFamilyRepo } from "../../../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { UnderwriterFamilyMembershipRepo } from "../../../storage/canonical/UnderwriterFamilyMembershipRepo";
import { UnderwriterLinkRepo } from "../../../storage/canonical/UnderwriterLinkRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { normalizeUnderwriterFamilyName } from "../../../resolver/UnderwriterFamilyResolver";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML =
  "<h1>UNDERWRITING</h1><p>Goldman Sachs &amp; Co. LLC and Goldman Sachs &amp; Co. II LLC.</p>";
const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

const emptyTerms = {
  security_type: null,
  shares_offered: null,
  price: null,
  price_low: null,
  price_high: null,
  gross_proceeds: null,
  net_proceeds: null,
  over_allotment_shares: null,
  units_offered: null,
  price_per_unit: null,
  unit_composition: null,
  warrant_fraction_per_unit: null,
  right_fraction_per_unit: null,
  trust_per_unit: null,
  over_allotment_units: null,
  exchange: null,
  par_value: null,
  confidence: 0.5,
  source_span: "x",
  tickers: [],
};

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

  it("links two series vehicles of one house to one family", async () => {
    // Sections present: Underwriting only. Call order: offering-terms (1st; reads
    // Underwriting text), then underwriters (2nd). Provide both payloads.
    //
    // The family key is companyFamilyName of the legal name, so a series marker
    // drops and both vehicles land on one house. They stay two companies —
    // identity keeps the numeral. Joining unrelated legal names (GS Securities
    // → Goldman Sachs) is an alias, not this persist path.
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: null,
        shares_offered: null,
        price: null,
        price_low: null,
        price_high: null,
        gross_proceeds: null,
        net_proceeds: null,
        over_allotment_shares: null,
        units_offered: null,
        price_per_unit: null,
        unit_composition: null,
        warrant_fraction_per_unit: null,
        right_fraction_per_unit: null,
        trust_per_unit: null,
        over_allotment_units: null,
        exchange: null,
        par_value: null,
        confidence: 0.5,
        source_span: "x",
        tickers: [],
      },
      {
        underwriters: [
          {
            legal_name: "Goldman Sachs & Co. LLC",
            role: "lead",
            shares_allocated: 3000000,
            over_allotment_shares: 450000,
            confidence: 0.95,
            source_span: "Goldman Sachs & Co. LLC",
          },
          {
            legal_name: "Goldman Sachs & Co. II LLC",
            role: "bookrunner",
            shares_allocated: 1000000,
            over_allotment_shares: null,
            confidence: 0.9,
            source_span: "Goldman Sachs & Co. II LLC",
          },
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

    // Computed, not spelled: the family key is derived from the legal name, so
    // hardcoding its shape here would pin a format rather than the behaviour.
    const family = await new CanonicalUnderwriterFamilyRepo().findByResolverAndName(
      "1.0.0",
      normalizeUnderwriterFamilyName("Goldman Sachs & Co. LLC")
    );
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

  it("records one link row when the model repeats the same underwriter", async () => {
    // Observed live: a sole-underwriter filing came back with the same bank
    // once, twice, and three times across three consecutive runs. Every
    // duplicate used to mint its own observation, family membership and link
    // row, so `sec underwriter by-family` counted the model's stutter.
    const citi = (span: string) => ({
      legal_name: "Citigroup Global Markets Inc.",
      role: "underwriter",
      shares_allocated: null,
      over_allotment_shares: 4500000,
      confidence: 0.98,
      source_span: span,
    });
    const { unregister } = registerFakeStructuredProvider([
      {
        security_type: null,
        shares_offered: null,
        price: null,
        price_low: null,
        price_high: null,
        gross_proceeds: null,
        net_proceeds: null,
        over_allotment_shares: null,
        units_offered: null,
        price_per_unit: null,
        unit_composition: null,
        warrant_fraction_per_unit: null,
        right_fraction_per_unit: null,
        trust_per_unit: null,
        over_allotment_units: null,
        exchange: null,
        par_value: null,
        confidence: 0.5,
        source_span: "Citigroup",
        tickers: [],
      },
      {
        underwriters: [
          citi("Citigroup"),
          // Same entity, cited differently and punctuated differently.
          { ...citi("Citigroup Global Markets"), legal_name: "citigroup global markets inc" },
          citi("Citigroup"),
        ],
      },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "0000000000-26-000002",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: "<h1>UNDERWRITING</h1><p>Citigroup Global Markets Inc. is the underwriter.</p>",
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    expect(
      await new UnderwriterLinkRepo().count({ accession_number: "0000000000-26-000002" })
    ).toBe(1);
    const family = await new CanonicalUnderwriterFamilyRepo().findByResolverAndName(
      "1.0.0",
      normalizeUnderwriterFamilyName("Citigroup Global Markets Inc.")
    );
    expect(family).toBeDefined();
    const members = await new UnderwriterFamilyMembershipRepo().listCompaniesForFamily(
      "1.0.0",
      family!.canonical_underwriter_family_id
    );
    expect(members).toHaveLength(1);
    // Only the first spelling reaches the observation tier (the issuer's own
    // observation is also on this accession, hence filtering by name).
    const companies = await new CompanyObservationRepo().listAll();
    expect(
      companies.filter(
        (c) => c.accession_number === "0000000000-26-000002" && /citigroup/i.test(c.name ?? "")
      )
    ).toHaveLength(1);
  });

  it("drops a brand-only short name when the full legal name is also present", async () => {
    // Live 1822912: S-1 extractors returned both "Cantor Fitzgerald & Co." and
    // "Cantor", which keyed two families and showed as duplicate underwriters.
    const { unregister } = registerFakeStructuredProvider([
      emptyTerms,
      {
        underwriters: [
          {
            legal_name: "Cantor Fitzgerald & Co.",
            role: "lead",
            shares_allocated: null,
            over_allotment_shares: null,
            confidence: 0.95,
            source_span: "Cantor Fitzgerald & Co.",
          },
          {
            legal_name: "Cantor",
            role: "underwriter",
            shares_allocated: null,
            over_allotment_shares: null,
            confidence: 0.9,
            source_span: "Cantor",
          },
        ],
      },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1822912,
      file_number: "333-1",
      accession_number: "0000000000-26-000003",
      filing_date: "2021-01-11",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: "<h1>UNDERWRITING</h1><p>Cantor Fitzgerald &amp; Co. (Cantor) is the underwriter.</p>",
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    expect(
      await new UnderwriterLinkRepo().count({ accession_number: "0000000000-26-000003" })
    ).toBe(1);
    const families = await new CanonicalUnderwriterFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.map((f) => f.normalized_name).sort()).toEqual(["CANTOR-FITZGERALD"]);
  });

  it("splits a division-of underwriter onto X with family Y", async () => {
    const asFiled = "Kingswood Capital Markets, division of Benchmark Investments, Inc.";
    const { unregister } = registerFakeStructuredProvider([
      emptyTerms,
      {
        underwriters: [
          {
            legal_name: asFiled,
            role: "lead",
            shares_allocated: null,
            over_allotment_shares: null,
            confidence: 0.95,
            source_span: asFiled,
          },
        ],
      },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1863460,
      file_number: "333-1",
      accession_number: "0000000000-26-000004",
      filing_date: "2021-08-12",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: `<h1>UNDERWRITING</h1><p>${asFiled} is the underwriter.</p>`,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const companies = await new CompanyObservationRepo().listAll();
    const kw = companies.find((c) => c.name === "Kingswood Capital Markets Inc");
    expect(kw).toBeDefined();
    expect(JSON.parse(kw!.source_context!)).toEqual({
      relation: "s1:underwriter",
      as_filed: asFiled,
      family_name: "Benchmark Investments, Inc.",
    });

    const family = await new CanonicalUnderwriterFamilyRepo().findByResolverAndName(
      "1.0.0",
      normalizeUnderwriterFamilyName("Benchmark Investments, Inc.")
    );
    expect(family).toBeDefined();
    expect(family!.normalized_name).toBe("BENCHMARK-INVESTMENTS");
    const members = await new UnderwriterFamilyMembershipRepo().listCompaniesForFamily(
      "1.0.0",
      family!.canonical_underwriter_family_id
    );
    expect(members).toHaveLength(1);
  });
});
