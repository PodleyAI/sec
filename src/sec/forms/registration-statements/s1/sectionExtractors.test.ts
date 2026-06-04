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
