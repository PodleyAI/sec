/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { hasRelatedPartyTable, parseRelatedPartyTables } from "./parseRelatedPartyTables";

const NOTES = [
  "| Convertible Note Purchasers | Original Principal Amount |",
  "| Stellantis Ventures B.V. | $5,000,000 |",
  "| Michael Bly | $250,000 |",
  "| Table of Contents |  |",
].join("\n");

const BULLETS = [
  "|  |  |",
  "| · | any of our directors or officers; |",
  "| · | any person proposed as a nominee for election as a director; |",
].join("\n");

const TOC = ["| Table of Contents |", "| 83 |"].join("\n");

const SPAC_BENEFITS = [
  "| Ø | 3,000,000 ordinary shares held by our initial shareholders. |",
  "| Ø | Reimbursement for any out-of-pocket expenses related to identifying, investigating and completing an initial business combination; and |",
  "| · | Repayment of up to an aggregate of $250,000 in loans made to us by our sponsor to cover offering-related and organizational expenses; |",
  "| ● | Payment to Calisa Holding LP of $10,000 per month for office space, secretarial and administrative services. |",
].join("\n");

describe("parseRelatedPartyTables", () => {
  it("never throws", () => {
    expect(parseRelatedPartyTables("")).toEqual([]);
    expect(parseRelatedPartyTables("|  |")).toEqual([]);
  });

  it("reads a purchaser/amount table and skips furniture", () => {
    const rows = parseRelatedPartyTables(NOTES);
    expect(rows.map((r) => [r.name, r.party_kind])).toEqual([
      ["Stellantis Ventures B.V.", "company"],
      ["Michael Bly", "person"],
    ]);
    expect(rows.every((r) => r.source === "deterministic")).toBe(true);
  });

  it("does not hit policy bullets or TOC furniture", () => {
    expect(parseRelatedPartyTables(BULLETS)).toEqual([]);
    expect(parseRelatedPartyTables(TOC)).toEqual([]);
  });

  it("does not treat SPAC related-party benefit bullets as a party table", () => {
    expect(hasRelatedPartyTable(SPAC_BENEFITS)).toBe(false);
    expect(parseRelatedPartyTables(SPAC_BENEFITS)).toEqual([]);
  });
});
