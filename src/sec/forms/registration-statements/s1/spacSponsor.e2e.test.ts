/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../../../config/TestingDI";
import { setupAllDatabases } from "../../../../config/setupAllDatabases";
import { registerFakeStructuredProvider, fakeS1Model } from "./testing/fakeStructuredProvider";
import { processFormS1 } from "../Form_S_1.storage";
import { S1ClassificationRepo } from "../../../../storage/classification/S1ClassificationRepo";
import { SpacSponsorLinkRepo } from "../../../../storage/canonical/SpacSponsorLinkRepo";
import { CanonicalSponsorFamilyRepo } from "../../../../storage/canonical/CanonicalSponsorFamilyRepo";
import { SponsorFamilyMembershipRepo } from "../../../../storage/canonical/SponsorFamilyMembershipRepo";

// Body with the three target headings so the section extractors run in a fixed
// order (management, ownership, related); sponsor extraction runs last when SPAC.
const BODY = [
  "<h1>MANAGEMENT</h1><p>x</p>",
  "<h1>PRINCIPAL AND SELLING STOCKHOLDERS</h1><p>x</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1><p>The Sponsor backs this SPAC.</p>",
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
            common_name: "Acme Sponsor",
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

  it("unifies two SPACs with the same sponsor common name under one family", async () => {
    ({ unregister } = registerFakeStructuredProvider([
      ...EMPTY_SECTIONS,
      {
        sponsors: [
          {
            legal_name: "Acme Sponsor, LLC",
            common_name: "Acme Sponsor",
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
            common_name: "Acme Sponsor",
            confidence: 0.9,
            source_span: "Acme Sponsor 2, LLC",
          },
        ],
      },
    ]));
    await processFormS1(runArgs(222, "0000000000-26-000302", 6770));

    const families = await new CanonicalSponsorFamilyRepo().listForResolverVersion("1.0.0");
    expect(families.length).toBe(1); // same common name -> one family
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
});
