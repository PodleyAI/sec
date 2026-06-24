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
  extractUnderwriters,
  extractUseOfProceeds,
  extractMergerDeal,
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

it("extractMergerDeal returns the parsed merger object", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      target_name: "Acme Target Inc.",
      pipe_amount: 150000000,
      merger_consideration: "$10.00 per share in stock",
      confidence: 0.92,
      source_span: "merger with Acme Target Inc.",
    },
  ]);
  try {
    const got = await extractMergerDeal("THE MERGER ...", fakeS1Model());
    expect(got?.target_name).toBe("Acme Target Inc.");
    expect(got?.pipe_amount).toBe(150000000);
  } finally {
    unregister();
  }
});

it("extractMergerDeal throws on schema-invalid model output (caller dead-letters it)", async () => {
  // Missing the required `confidence` field -> schema validation rejects it.
  const { unregister } = registerFakeStructuredProvider([
    { target_name: "Acme Target Inc.", pipe_amount: null, merger_consideration: null },
  ]);
  try {
    await expect(extractMergerDeal("THE MERGER ...", fakeS1Model())).rejects.toThrow();
  } finally {
    unregister();
  }
});

it("extractOfferingTerms throws on schema-invalid model output (caller dead-letters it)", async () => {
  const { unregister } = registerFakeStructuredProvider([{ tickers: [] }]);
  try {
    await expect(extractOfferingTerms("THE OFFERING ...", fakeS1Model())).rejects.toThrow();
  } finally {
    unregister();
  }
});

it("extractUnderwriters returns parsed underwriter rows", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      underwriters: [
        {
          legal_name: "Goldman Sachs & Co. LLC",
          common_name: "Goldman Sachs",
          role: "lead",
          shares_allocated: 3000000,
          over_allotment_shares: 450000,
          confidence: 0.95,
          source_span: "Goldman Sachs & Co. LLC",
        },
      ],
    },
  ]);
  try {
    const rows = await extractUnderwriters("UNDERWRITING ...", fakeS1Model());
    expect(rows[0].common_name).toBe("Goldman Sachs");
    expect(rows[0].role).toBe("lead");
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

it("extractUseOfProceeds returns parsed line items", async () => {
  const { unregister } = registerFakeStructuredProvider([
    {
      line_items: [
        { purpose: "repay debt", amount: 20000000, percent: 40, note: null, confidence: 0.8, source_span: "repay" },
        { purpose: "working capital", amount: null, percent: null, note: "remainder", confidence: 0.6, source_span: "wc" },
      ],
    },
  ]);
  try {
    const rows = await extractUseOfProceeds("USE OF PROCEEDS ...", fakeS1Model());
    expect(rows).toHaveLength(2);
    expect(rows[0].amount).toBe(20000000);
  } finally {
    unregister();
  }
});
