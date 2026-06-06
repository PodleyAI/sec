/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  extractManagement,
  extractBeneficialOwnership,
  extractRelatedParty,
  extractSpacSponsors,
  extractOfferingTerms,
} from "./sectionExtractors";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("section extractors", () => {
  it("extractManagement returns parsed people", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        people: [
          {
            full_name: "Jane Roe",
            title: "Director",
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe, Director",
          },
        ],
      },
    ]);
    cleanup = unregister;
    const people = await extractManagement("Jane Roe, Director", fakeS1Model());
    expect(people).toHaveLength(1);
    expect(people[0].full_name).toBe("Jane Roe");
  });

  it("extractBeneficialOwnership returns owners with figures", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        owners: [
          {
            name: "ACME Fund",
            owner_kind: "company",
            security_class: "Common",
            shares_owned: 1000000,
            percent_owned: 12.5,
            shares_offered: null,
            shares_after: null,
            percent_after: null,
            is_selling_stockholder: false,
            footnote: null,
            confidence: 0.8,
            source_span: "ACME Fund 1,000,000 12.5%",
          },
        ],
      },
    ]);
    cleanup = unregister;
    const owners = await extractBeneficialOwnership("ACME Fund\t1,000,000\t12.5%", fakeS1Model());
    expect(owners[0].percent_owned).toBe(12.5);
  });

  it("extractRelatedParty returns parties with transactions", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        parties: [
          {
            name: "John Doe",
            party_kind: "person",
            confidence: 0.85,
            source_span: "rent to entity controlled by John Doe",
            transactions: [
              {
                counterparty: "the Company",
                nature: "lease",
                amount: 120000,
                period: "2025",
                footnote: null,
              },
            ],
          },
        ],
      },
    ]);
    cleanup = unregister;
    const parties = await extractRelatedParty("We pay rent...", fakeS1Model());
    expect(parties[0].transactions[0].amount).toBe(120000);
  });
});

it("extractOfferingTerms returns the parsed offering object", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      security_type: "Units",
      shares_offered: null,
      price: null,
      price_low: null,
      price_high: null,
      gross_proceeds: 200000000,
      net_proceeds: null,
      over_allotment_shares: null,
      units_offered: 20000000,
      price_per_unit: 10,
      unit_composition: "one share and one-half warrant",
      warrant_fraction_per_unit: 0.5,
      right_fraction_per_unit: null,
      trust_per_unit: 10.1,
      over_allotment_units: 3000000,
      exchange: "NASDAQ",
      par_value: null,
      confidence: 0.9,
      source_span: "each unit",
      tickers: [{ ticker: "ACQU", exchange: "NASDAQ", security_type: "Units", is_primary: true }],
    },
  ]);
  try {
    const got = await extractOfferingTerms("THE OFFERING ...", fakeS1Model());
    expect(got?.units_offered).toBe(20000000);
    expect(got?.tickers[0].ticker).toBe("ACQU");
  } finally {
    unregister();
  }
});

it("extractSpacSponsors returns scripted sponsor rows", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      sponsors: [
        {
          legal_name: "Pershing Square Sponsor 2, LLC",
          common_name: "Pershing Square Sponsor",
          confidence: 0.95,
          source_span: "Pershing Square Sponsor 2, LLC",
        },
      ],
    },
  ]);
  try {
    const rows = await extractSpacSponsors(
      "The Sponsor is Pershing Square Sponsor 2, LLC.",
      fakeS1Model()
    );
    expect(rows[0].common_name).toBe("Pershing Square Sponsor");
    expect(rows[0].legal_name).toBe("Pershing Square Sponsor 2, LLC");
  } finally {
    unregister();
  }
});
