/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { setupAllDatabases } from "../../../../config/setupAllDatabases";
import { registerFakeStructuredProvider, fakeS1Model } from "./testing/fakeStructuredProvider";
import { processFormS1 } from "../Form_S_1.storage";
import { S1ClassificationRepo } from "../../../../storage/classification/S1ClassificationRepo";
import { SpacSponsorLinkRepo } from "../../../../storage/canonical/SpacSponsorLinkRepo";
import { CanonicalSponsorFamilyRepo } from "../../../../storage/canonical/CanonicalSponsorFamilyRepo";
import { SponsorFamilyMembershipRepo } from "../../../../storage/canonical/SponsorFamilyMembershipRepo";
import { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { CompanyObservationRepo } from "../../../../storage/observation/CompanyObservationRepo";
import { normalizeSponsorFamilyName } from "../../../../resolver/SponsorFamilyResolver";

// Body with the three target headings so the section extractors run in a fixed
// order (management, ownership, related); sponsor extraction runs last when SPAC.
//
// The related-party paragraph includes the sponsor legal names that the tests'
// fake provider returns, so the source_span verification (post-1.1.0)
// accepts them. The blank "x" placeholders are kept in the other sections so
// management / ownership extractors still run with empty input.
const BODY = [
  "<h1>MANAGEMENT</h1><p>x</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1><p>x</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1>",
  "<p>The Sponsor backs this SPAC. Acme Sponsor 2, LLC and Acme Sponsor, LLC are the sponsors. 26 Capital Holdings LLC is the sponsor of 26 Capital Acquisition Corp. Acme Sponsor LLC, a wholly-owned subsidiary of Big Bank Inc. backs this SPAC.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

function parsed(sic: number | null) {
  return {
    header: {
      sic,
      sicDescription: sic === 6770 ? "BLANK CHECKS" : null,
      cik: null,
      companyName: null,
      filingDate: null,
    },
    html: BODY,
  };
}

const EMPTY_SECTIONS = [{ people: [] }, { owners: [] }, { parties: [] }];

function runArgs(cik: number, accession: string, sic: number | null) {
  return {
    cik,
    file_number: "333-1",
    accession_number: accession,
    filing_date: "2026-01-01",
    primary_doc: `${accession}.txt`,
    form: "S-1",
    formS1: parsed(sic) as never,
    model: fakeS1Model(),
  };
}

describe("SPAC sponsor end-to-end", () => {
  let unregister: (() => void) | undefined;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    unregister?.();
    unregister = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("classifies a SPAC and links sponsor -> family -> issuer", async () => {
    ({ unregister } = registerFakeStructuredProvider([
      ...EMPTY_SECTIONS,
      {
        sponsors: [
          {
            legal_name: "Acme Sponsor 2, LLC",
            confidence: 0.95,
            source_span: "Acme Sponsor 2, LLC",
          },
        ],
      },
    ]));

    await processFormS1(runArgs(1848507, "0000000000-26-000201", 6770));

    const cls = await new S1ClassificationRepo().get("S-1", "0000000000-26-000201");
    expect(cls?.is_spac).toBe(true);
    expect(cls?.classifier_source).toBe("sgml-header");

    const families = await new CanonicalSponsorFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.length).toBe(1);
    const famId = families[0].canonical_sponsor_family_id;
    expect(await new SpacSponsorLinkRepo().listIssuerCiksForFamily(famId)).toEqual([1848507]);
  });

  it("keys the sponsor family off the legal name so Holdings is kept", async () => {
    // Live split: the model sometimes emitted common_name "26 Capital" and
    // sometimes "26 Capital Holdings" for the same legal entity. The family
    // key is now companyFamilyName(legal_name), which keeps Holdings.
    const holdings = {
      legal_name: "26 Capital Holdings LLC",
      confidence: 0.95,
      source_span: "26 Capital Holdings LLC",
    };
    ({ unregister } = registerFakeStructuredProvider([...EMPTY_SECTIONS, { sponsors: [holdings] }]));
    await processFormS1(runArgs(1822912, "0000000000-26-000801", 6770));
    unregister?.();

    ({ unregister } = registerFakeStructuredProvider([...EMPTY_SECTIONS, { sponsors: [holdings] }]));
    await processFormS1(runArgs(1822912, "0000000000-26-000802", 6770));

    const families = await new CanonicalSponsorFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.map((f) => f.normalized_name).sort()).toEqual(["26-CAPITAL-HOLDINGS"]);
  });

  it("unifies series vehicles of one sponsor under one family", async () => {
    ({ unregister } = registerFakeStructuredProvider([
      ...EMPTY_SECTIONS,
      {
        sponsors: [
          {
            legal_name: "Acme Sponsor, LLC",
            confidence: 0.9,
            source_span: "Acme Sponsor, LLC",
          },
        ],
      },
    ]));
    await processFormS1(runArgs(111, "0000000000-26-000301", 6770));
    unregister?.();

    ({ unregister } = registerFakeStructuredProvider([
      ...EMPTY_SECTIONS,
      {
        sponsors: [
          {
            legal_name: "Acme Sponsor 2, LLC",
            confidence: 0.9,
            source_span: "Acme Sponsor 2, LLC",
          },
        ],
      },
    ]));
    await processFormS1(runArgs(222, "0000000000-26-000302", 6770));

    const families = await new CanonicalSponsorFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.length).toBe(1);
    const famId = families[0].canonical_sponsor_family_id;

    const members = await new SponsorFamilyMembershipRepo().listCompaniesForFamily("1.0.0", famId);
    expect(members.length).toBe(2); // two distinct legal sponsors

    const issuers = await new SpacSponsorLinkRepo().listIssuerCiksForFamily(famId);
    expect([...issuers].sort((a, b) => a - b)).toEqual([111, 222]);
  });

  it("does not extract sponsors or dead-letter when sic != 6770", async () => {
    ({ unregister } = registerFakeStructuredProvider([...EMPTY_SECTIONS]));
    await processFormS1(runArgs(333, "0000000000-26-000401", 1234));

    const cls = await new S1ClassificationRepo().get("S-1", "0000000000-26-000401");
    expect(cls?.is_spac).toBe(false);
    const families = await new CanonicalSponsorFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.length).toBe(0);
  });

  it("drops sponsor rows whose source_span is not present in section text", async () => {
    ({ unregister } = registerFakeStructuredProvider([
      ...EMPTY_SECTIONS,
      {
        sponsors: [
          {
            // Both rows have plausible names but neither source_span appears
            // anywhere in the BODY sections — this is the LLM-hallucination case.
            legal_name: "Phantom Sponsor, LLC",
            confidence: 0.95,
            source_span: "This phrase is not anywhere in the prospectus body.",
          },
          {
            legal_name: "Ghost Capital, LLC",
            confidence: 0.95,
            source_span: "Another fabricated quotation that does not occur.",
          },
        ],
      },
    ]));

    await processFormS1(runArgs(555, "0000000000-26-000601", 6770));

    // No families and no sponsor links should have been written.
    const families = await new CanonicalSponsorFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.length).toBe(0);

    // A dead-letter under UNVERIFIED_SOURCE_SPAN should be recorded.
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    const sponsorDl = dl.find(
      (d) => d.section_name === "spac-sponsors" && d.accession_number === "0000000000-26-000601"
    );
    expect(sponsorDl?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
  });

  it("writes verified sponsor rows and dead-letters a partial for unverified ones", async () => {
    ({ unregister } = registerFakeStructuredProvider([
      ...EMPTY_SECTIONS,
      {
        sponsors: [
          {
            // Verified: this exact phrase appears in the related-party section.
            legal_name: "Acme Sponsor, LLC",
            confidence: 0.95,
            source_span: "The Sponsor backs this SPAC.",
          },
          {
            // Hallucinated: this phrase does not appear in any section text.
            legal_name: "Phantom Sponsor, LLC",
            confidence: 0.95,
            source_span: "Phrase definitely not present in the body.",
          },
        ],
      },
    ]));

    await processFormS1(runArgs(666, "0000000000-26-000701", 6770));

    // The verified sponsor still resolved to a family and a link.
    const families = await new CanonicalSponsorFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.length).toBe(1);
    const famId = families[0].canonical_sponsor_family_id;
    expect(await new SpacSponsorLinkRepo().listIssuerCiksForFamily(famId)).toEqual([666]);

    // A spac-sponsors-partial dead-letter records the dropped row for triage.
    const dl = await new ExtractionDeadLetterRepo().listPending("S-1");
    const partial = dl.find(
      (d) =>
        d.section_name === "spac-sponsors-partial" &&
        d.accession_number === "0000000000-26-000701"
    );
    expect(partial?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
  });

  it("skips a blank-named sponsor row without dropping the valid ones", async () => {
    ({ unregister } = registerFakeStructuredProvider([
      ...EMPTY_SECTIONS,
      {
        sponsors: [
          { legal_name: "", confidence: 0.9, source_span: "x" }, // degenerate
          { legal_name: "Acme Sponsor, LLC", confidence: 0.9, source_span: "Acme Sponsor, LLC" },
        ],
      },
    ]));
    await processFormS1(runArgs(444, "0000000000-26-000501", 6770));

    const families = await new CanonicalSponsorFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.length).toBe(1); // the valid sponsor still resolved a family
    const famId = families[0].canonical_sponsor_family_id;
    expect(await new SpacSponsorLinkRepo().listIssuerCiksForFamily(famId)).toEqual([444]);
  });

  it("splits a wholly-owned-subsidiary sponsor onto X with family Y", async () => {
    const asFiled = "Acme Sponsor LLC, a wholly-owned subsidiary of Big Bank Inc.";
    ({ unregister } = registerFakeStructuredProvider([
      ...EMPTY_SECTIONS,
      {
        sponsors: [
          {
            legal_name: asFiled,
            confidence: 0.95,
            source_span: asFiled,
          },
        ],
      },
    ]));

    await processFormS1(runArgs(1848507, "0000000000-26-000901", 6770));

    const companies = await new CompanyObservationRepo().listAll();
    const sponsor = companies.find(
      (c) => c.accession_number === "0000000000-26-000901" && c.name === "Acme Sponsor LLC"
    );
    expect(sponsor).toBeDefined();
    expect(JSON.parse(sponsor!.source_context!)).toEqual({
      relation: "s1:spac-sponsor",
      as_filed: asFiled,
      family_name: "Big Bank Inc.",
    });

    const family = await new CanonicalSponsorFamilyRepo().findByResolverAndName(
      "1.0.0",
      normalizeSponsorFamilyName("Big Bank Inc.")
    );
    expect(family).toBeDefined();
    expect(family!.normalized_name).toBe("BIG-BANK");
  });
});
