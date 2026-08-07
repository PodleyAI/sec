/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { BeneficialOwnershipRepo } from "../../../storage/beneficial-ownership/BeneficialOwnershipRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";
import { VERIFICATION_ATTEMPTS } from "./s1/sectionRunner";

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

describe("processFormS1 prompt-injection backstop", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("rejects a management row whose source_span is not in section text and dead-letters UNVERIFIED_SOURCE_SPAN", async () => {
    // The model returns a single row pretending to be a real director, but
    // the source_span "Fake Person Inc." is NOT a substring of the
    // management section we sent. verifyRow drops the row; runSection
    // dead-letters UNVERIFIED_SOURCE_SPAN.
    const fabricated = {
      people: [
        {
          full_name: "Fake Person",
          titles: ["Director"],
          relationship: null,
          confidence: 0.95,
          source_span: "Fake Person Inc.",
        },
      ],
    };
    // A total verification wipeout is re-asked (VERIFICATION_ATTEMPTS), so the
    // model must keep fabricating for the section to stay unverified — which is
    // exactly the persistent-attacker case this asserts.
    const { unregister } = registerFakeStructuredProvider([
      ...Array.from({ length: VERIFICATION_ATTEMPTS }, () => fabricated),
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    const accession = "0000000000-26-injection-1";
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

    // The issuer observation is still recorded — only the fabricated row is
    // dropped — so we count only Management-relation persons (issuer is a
    // company observation, not a person).
    // No rows persisted, the dead-letter records UNVERIFIED_SOURCE_SPAN.
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    const mgmt = dl.find((d) => d.section_name === "Management");
    expect(mgmt?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
  });

  it("with one legit and one fabricated row, persists the legit one and records a partial dead-letter", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
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
            confidence: 0.85,
            // Legitimate row: source_span matches the Markdown-rendered table.
            source_span: "| ACME Fund | 1,000,000 | 12.5% |",
          },
          {
            name: "Hallucinated Holdings",
            owner_kind: "company",
            security_class: null,
            shares_owned: 999999,
            percent_owned: 90,
            shares_offered: null,
            shares_after: null,
            percent_after: null,
            is_selling_stockholder: false,
            footnote: null,
            confidence: 0.95,
            // Fabricated row: source_span is not in the section text.
            source_span: "Hallucinated Holdings owns 90% of all securities",
          },
        ],
      },
      { parties: [] },
    ]);
    cleanup = unregister;

    const accession = "0000000000-26-injection-2";
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

    // Legit row persisted, fabricated row dropped.
    const owners = await new BeneficialOwnershipRepo().queryByAccession(accession);
    expect(owners).toHaveLength(1);
    expect(owners[0].percent_owned).toBe(12.5);
    // No phantom Hallucinated Holdings company observation reached the
    // canonical tier.
    const companies = await new CompanyObservationRepo().listAll();
    expect(
      companies.some((c) => c.accession_number === accession && c.name === "Hallucinated Holdings")
    ).toBe(false);
    // The partial-drop bookkeeping records a "<sectionName>-partial"
    // UNVERIFIED_SOURCE_SPAN dead-letter for triage.
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    const partial = dl.find((d) => d.section_name === "Principal and Selling Stockholders-partial");
    expect(partial?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
  });

  it("drops a row whose raw source_span is bulk whitespace exceeding the storage cap, even if it would normalize to a substring", async () => {
    // The model returns a row whose source_span is a real fragment padded
    // with ~1500 chars of raw whitespace. Under whitespace-collapse the
    // normalized span would still appear in the section text and pass the
    // legacy spanAppearsIn check; the storage-side raw-cap rejects it
    // BEFORE normalization to keep an attacker from staging unbounded raw
    // bytes through a verifier-passing row.
    const paddedSpan = "Jane Roe — Director" + " ".repeat(1500);
    expect(paddedSpan.length).toBeGreaterThan(1000);
    const padded = {
      people: [
        {
          full_name: "Jane Roe",
          titles: ["Director"],
          relationship: null,
          confidence: 0.9,
          source_span: paddedSpan,
        },
      ],
    };
    const { unregister } = registerFakeStructuredProvider([
      ...Array.from({ length: VERIFICATION_ATTEMPTS }, () => padded),
      { owners: [] },
      { parties: [] },
    ]);
    cleanup = unregister;

    const accession = "0000000000-26-injection-3";
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

    // The security property: the row is dropped, nothing persists.
    expect(await new PersonObservationRepo().listByAccession(accession)).toEqual([]);
    // The diagnostic: an over-cap span reports as over-cap, not as absent from
    // the section text — the span here IS a real fragment of it.
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    const mgmt = dl.find((d) => d.section_name === "Management");
    expect(mgmt?.reason_code).toBe("SOURCE_SPAN_TOO_LONG");
  });
});
