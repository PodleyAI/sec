/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { RelatedPartyTransactionRepo } from "../../../storage/related-party/RelatedPartyTransactionRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML_PARSEABLE = [
  "<h1>MANAGEMENT</h1>",
  "<p>Jane Roe — Director</p>",
  "<h1>CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</h1>",
  "<table>",
  "<tr><td>Convertible Note Purchasers</td><td>Original Principal Amount</td></tr>",
  "<tr><td>Stellantis Ventures B.V.</td><td>$5,000,000</td></tr>",
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

const RELATED_PARTY_PAYLOAD = {
  parties: [
    {
      name: "Stellantis Ventures B.V.",
      party_kind: "company",
      confidence: 0.9,
      source_span: "Stellantis Ventures B.V.",
      transactions: [
        {
          counterparty: null,
          nature: "Convertible note purchase",
          amount: 5000000,
          period: null,
          footnote: null,
        },
      ],
    },
  ],
};

const MANAGEMENT_PAYLOAD = {
  people: [
    {
      full_name: "Jane Roe",
      titles: ["Director"],
      relationship: null,
      confidence: 0.9,
      source_span: "Jane Roe — Director",
    },
  ],
};

let cleanup: (() => void) | undefined;

describe("processFormS1 related-party tables", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("runs the related-party model even when the party table parses, because the parse carries no transaction", async () => {
    // The table walk names the parties and reads no figures, but the section
    // clears `related_party_transaction` before it writes. Preempting on the
    // names alone empties the disclosure and resolves the section clean.
    const { calls, unregister } = registerFakeStructuredProvider([
      MANAGEMENT_PAYLOAD,
      RELATED_PARTY_PAYLOAD,
    ]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "acc-rp-1",
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

    expect(calls.some((p) => /Extract related parties/.test(p))).toBe(true);
    const companies = await new CompanyObservationRepo().listAll();
    expect(companies.some((c) => /Stellantis Ventures/i.test(c.name ?? ""))).toBe(true);
    const transactions = await new RelatedPartyTransactionRepo().queryByAccession("acc-rp-1");
    expect(transactions.length).toBeGreaterThanOrEqual(1);
    expect(transactions[0]!.amount).toBe(5_000_000);
  });
});
