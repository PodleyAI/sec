/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { BeneficialOwnershipRepo } from "../../../storage/beneficial-ownership/BeneficialOwnershipRepo";
import { S1ClassificationRepo } from "../../../storage/classification/S1ClassificationRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { RelatedPartyTransactionRepo } from "../../../storage/related-party/RelatedPartyTransactionRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML = [
  "<h1>MANAGEMENT</h1>",
  "<p>Jane Roe — Director</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1>",
  "<table><tr><td>ACME Fund</td><td>1,000,000</td><td>12.5%</td></tr></table>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1>",
  "<p>We pay rent to an entity controlled by our CEO.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

let cleanup: (() => void) | undefined;

describe("processFormS1", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("observes issuer + people + entities and writes figures", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        people: [
          {
            full_name: "Jane Roe",
            titles: ["Director"],
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe — Director",
          },
        ],
      },
      {
        owners: [
          {
            name: "ACME Fund",
            owner_kind: "company",
            security_class: null,
            shares_owned: 1000000,
            percent_owned: 12.5,
            shares_offered: null,
            shares_after: null,
            percent_after: null,
            is_selling_stockholder: false,
            footnote: null,
            confidence: 0.8,
            // The segmenter renders the HTML table as Markdown, so the
            // verifyRow gate needs a substring that matches the rendered
            // table row literally.
            source_span: "| ACME Fund | 1,000,000 | 12.5% |",
          },
        ],
      },
      {
        parties: [
          {
            name: "Acme Holdings",
            party_kind: "company",
            confidence: 0.7,
            source_span: "entity controlled by our CEO",
            transactions: [
              {
                counterparty: "the Company",
                nature: "lease",
                amount: 120000,
                period: null,
                footnote: null,
              },
            ],
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
    expect(companies.some((c) => c.cik === 1018724)).toBe(true);

    const people = await new PersonObservationRepo().listAll();
    expect(people.some((p) => p.last_name === "Roe" || p.first_name === "Jane")).toBe(true);

    const owners = await new BeneficialOwnershipRepo().queryByAccession("0000000000-26-000001");
    expect(owners[0].percent_owned).toBe(12.5);

    const tx = await new RelatedPartyTransactionRepo().queryByAccession("0000000000-26-000001");
    expect(tx[0].amount).toBe(120000);

    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    // The Offering / Underwriting / Use of Proceeds headings are absent from
    // this fixture, so those sections dead-letter SECTION_NOT_FOUND. Risk
    // factors is parked and must not appear. Executive Compensation is
    // deliberately NOT among them: most registration statements have no
    // compensation section, so recording one would put an entry on the retry
    // worklist for the majority of all S-1s, permanently.
    expect(dl.map((d) => d.section_name).sort()).toEqual([
      "offering-terms",
      "underwriters",
      "use-of-proceeds",
    ]);
  });

  it("dead-letters a section that yields no rows", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      {
        owners: [
          {
            name: "ACME Fund",
            owner_kind: "company",
            security_class: null,
            shares_owned: null,
            percent_owned: null,
            shares_offered: null,
            shares_after: null,
            percent_after: null,
            is_selling_stockholder: false,
            footnote: null,
            confidence: 0.8,
            source_span: "ACME Fund",
          },
        ],
      },
      { parties: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "",
      accession_number: "accX",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    const reasons = new Map(dl.map((d) => [d.section_name, d.reason_code]));
    expect(reasons.get("Management")).toBe("MODEL_EMPTY");
    expect(reasons.get("Certain Relationships and Related Transactions")).toBe("MODEL_EMPTY");
    expect(reasons.has("Principal and Selling Stockholders")).toBe(false);
  });

  it("reconciles a dead-lettered section to resolved on a successful re-run", async () => {
    const acc = "accR";
    const deadLetters = new ExtractionDeadLetterRepo();

    // First run: Management yields nothing → recorded as a pending dead letter.
    const first = registerFakeStructuredProvider([{ people: [] }, { owners: [] }, { parties: [] }]);
    await processFormS1({
      cik: 1018724,
      file_number: "",
      accession_number: acc,
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });
    first.unregister();
    expect((await deadLetters.get("S-1", acc, "Management"))?.status).toBe("pending");

    // Second run (same version): Management now yields a person → entry flips to resolved.
    const second = registerFakeStructuredProvider([
      {
        people: [
          {
            full_name: "Jane Roe",
            titles: [],
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe",
          },
        ],
      },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = second.unregister;
    await processFormS1({
      cik: 1018724,
      file_number: "",
      accession_number: acc,
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    expect((await deadLetters.get("S-1", acc, "Management"))?.status).toBe("resolved");
  });

  it("records a sic-unknown, non-SPAC classification for a header-less body", async () => {
    const ACCESSION = "acc-classification-test";
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "",
      accession_number: ACCESSION,
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const c = await new S1ClassificationRepo().get("S-1", ACCESSION);
    expect(c?.is_spac).toBe(false);
    expect(c?.classifier_source).toBe("sic-unknown");
  });

  it("keeps a group-level related-party disclosure but mints no person for it", async () => {
    // Real Item 404 arrangements are disclosed against the officer/director
    // group as a class. The disclosure is worth keeping; "Our Officers And
    // Directors" as a canonical person is not.
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      {
        parties: [
          {
            name: "Our Officers And Directors",
            party_kind: "person",
            confidence: 0.9,
            source_span: "We pay rent to an entity controlled by our CEO.",
            transactions: [
              {
                counterparty: null,
                nature: "Potential loans to fund working capital deficiencies",
                amount: 1500000,
                period: null,
                footnote: null,
              },
            ],
          },
          {
            name: "Michael Klein",
            party_kind: "person",
            confidence: 0.9,
            source_span: "We pay rent to an entity controlled by our CEO.",
            transactions: [
              {
                counterparty: null,
                nature: "Purchase of Class B ordinary shares",
                amount: 25000,
                period: null,
                footnote: null,
              },
            ],
          },
        ],
      },
    ]);
    cleanup = unregister;

    const accession = "0000000000-26-collective";
    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: accession,
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    // Both disclosures survive — nothing real is thrown away.
    const tx = await new RelatedPartyTransactionRepo().queryByAccession(accession);
    expect(tx.map((t) => t.amount).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([25000, 1500000]);
    // The group's row keeps the filing's own wording and names no entity, so a
    // person query (which must filter party_kind anyway — observation_id is
    // polymorphic across two id sequences) structurally cannot see it.
    const groupRow = tx.find((t) => t.amount === 1500000);
    expect(groupRow?.party_kind).toBe("group");
    expect(groupRow?.party_label).toBe("Our Officers And Directors");
    expect(groupRow?.observation_id).toBeNull();
    // The named officer is unaffected: still a person, still attributed.
    const personRow = tx.find((t) => t.amount === 25000);
    expect(personRow?.party_kind).toBe("person");
    expect(personRow?.party_label).toBeNull();
    expect(personRow?.observation_id).not.toBeNull();
    // Only the real person reaches the observation tier.
    const people = await new PersonObservationRepo().listByAccession(accession);
    expect(people.map((p) => `${p.first_name} ${p.last_name}`)).toEqual(["Michael Klein"]);
  });

  it("keeps a blank-name related-party company without aborting the section", async () => {
    // Degenerate model output: a company row with no name. observeCompany used
    // to throw in the resolver ("no CIK, CRD, or name") and abort every other
    // valid party in the same persist — a live S-1/A hit exactly this.
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      {
        parties: [
          {
            name: "",
            party_kind: "company",
            confidence: 0.9,
            source_span: "We pay rent to an entity controlled by our CEO.",
            transactions: [
              {
                counterparty: "the Company",
                nature: "lease",
                amount: 50000,
                period: null,
                footnote: null,
              },
            ],
          },
          {
            name: "Acme Holdings",
            party_kind: "company",
            confidence: 0.9,
            source_span: "We pay rent to an entity controlled by our CEO.",
            transactions: [
              {
                counterparty: "the Company",
                nature: "consulting",
                amount: 120000,
                period: null,
                footnote: null,
              },
            ],
          },
        ],
      },
    ]);
    cleanup = unregister;

    const accession = "0000000000-26-blank-rp-co";
    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: accession,
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const tx = await new RelatedPartyTransactionRepo().queryByAccession(accession);
    expect(tx.map((t) => t.amount).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([50000, 120000]);
    const unnamed = tx.find((t) => t.amount === 50000);
    expect(unnamed?.party_kind).toBe("group");
    expect(unnamed?.observation_id).toBeNull();
    const named = tx.find((t) => t.amount === 120000);
    expect(named?.party_kind).toBe("company");
    expect(named?.observation_id).not.toBeNull();
    const companies = await new CompanyObservationRepo().listByAccession(accession);
    expect(companies.some((c) => c.name === "Acme Holdings")).toBe(true);
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(dl.filter((d) => d.section_name.includes("Related")).map((d) => d.reason_code)).toEqual(
      []
    );
  });

  it("keeps a legal-form-only related-party company name without aborting the section", async () => {
    // Degenerate model output: party name "Company" (as in "the Company").
    // That is not blank, so the empty-name skip does not fire, but
    // normalizeCompanyName strips it as the Co/Company legal-form ending and
    // the resolver then throws "no CIK, CRD, or name", aborting every other
    // valid party. A live S-1 (CIK 2140589) hit exactly this.
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      {
        parties: [
          {
            name: "Company",
            party_kind: "company",
            confidence: 0.9,
            source_span: "We pay rent to an entity controlled by our CEO.",
            transactions: [
              {
                counterparty: "the Company",
                nature: "lease",
                amount: 50000,
                period: null,
                footnote: null,
              },
            ],
          },
          {
            name: "Acme Holdings",
            party_kind: "company",
            confidence: 0.9,
            source_span: "We pay rent to an entity controlled by our CEO.",
            transactions: [
              {
                counterparty: "the Company",
                nature: "consulting",
                amount: 120000,
                period: null,
                footnote: null,
              },
            ],
          },
        ],
      },
    ]);
    cleanup = unregister;

    const accession = "0000000000-26-co-rp-name";
    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: accession,
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const tx = await new RelatedPartyTransactionRepo().queryByAccession(accession);
    expect(tx.map((t) => t.amount).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([50000, 120000]);
    const unnamed = tx.find((t) => t.amount === 50000);
    expect(unnamed?.party_kind).toBe("group");
    expect(unnamed?.observation_id).toBeNull();
    expect(unnamed?.party_label).toBe("Company");
    const named = tx.find((t) => t.amount === 120000);
    expect(named?.party_kind).toBe("company");
    expect(named?.observation_id).not.toBeNull();
    const companies = await new CompanyObservationRepo().listByAccession(accession);
    expect(companies.some((c) => c.name === "Acme Holdings")).toBe(true);
    expect(companies.some((c) => c.name === "Company")).toBe(false);
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(dl.filter((d) => d.section_name.includes("Related")).map((d) => d.reason_code)).toEqual(
      []
    );
  });

  it("treats 'the Company' as an unnamed group row, not a canonical identity", async () => {
    // After the legal-form-only skip, a live S-1 (CIK 2140589) still observed
    // "the Company", which normalizeCompanyName strips to "the" and mints a
    // canonical company. Issuer self-references are the same unnamed class.
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      { owners: [] },
      {
        parties: [
          {
            name: "the Company",
            party_kind: "company",
            confidence: 0.9,
            source_span: "We pay rent to an entity controlled by our CEO.",
            transactions: [
              {
                counterparty: "the Company",
                nature: "lease",
                amount: 50000,
                period: null,
                footnote: null,
              },
            ],
          },
          {
            name: "Acme Holdings",
            party_kind: "company",
            confidence: 0.9,
            source_span: "We pay rent to an entity controlled by our CEO.",
            transactions: [
              {
                counterparty: "the Company",
                nature: "consulting",
                amount: 120000,
                period: null,
                footnote: null,
              },
            ],
          },
        ],
      },
    ]);
    cleanup = unregister;

    const accession = "0000000000-26-the-co";
    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: accession,
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: { header: NULL_HEADER, html: HTML, xbrlInstanceXml: null, feeExhibitHtml: null },
      model: fakeS1Model(),
    });

    const tx = await new RelatedPartyTransactionRepo().queryByAccession(accession);
    const unnamed = tx.find((t) => t.amount === 50000);
    expect(unnamed?.party_kind).toBe("group");
    expect(unnamed?.observation_id).toBeNull();
    expect(unnamed?.party_label).toBe("the Company");
    const companies = await new CompanyObservationRepo().listByAccession(accession);
    expect(companies.some((c) => c.name === "the Company")).toBe(false);
    expect(companies.some((c) => (c.normalized_name ?? "").toLowerCase() === "the")).toBe(false);
    expect(companies.some((c) => c.name === "Acme Holdings")).toBe(true);
  });
});
