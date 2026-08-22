/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { hasSponsorIdentification, parseSpacSponsors } from "./parseSpacSponsors";

const APPOSITIVE =
  "Our sponsor, Bluerock Acquisition Holdings II, LLC, is a Delaware limited liability company and was formed to invest in us.";

const COPULA = "Our Sponsor is Samara Acquisition Sponsor VI Ltd.";

const THE_SPONSOR =
  "The Sponsor, Teucrium Asset Management, LLC, is a Delaware limited liability company.";

const NOISE = [
  "Our sponsor, officers or directors may purchase shares.",
  "Our sponsor is a Delaware limited liability company, which was recently formed to invest in our company.",
  "Our sponsor is an affiliate of 1Sharpe Capital, LLC (“1Sharpe Capital”).",
  "Our sponsor is majority-owned by our Chairman.",
  "our sponsor is currently sponsoring Trebia Acquistion Corp.",
  "The sole managing member of our sponsor is Bluerock Real Estate Holdings, LLC.",
  "Our sponsor is controlled by Kleinfeld Constellation Investment, LLC.",
].join(" ");

describe("parseSpacSponsors", () => {
  it("never throws", () => {
    expect(parseSpacSponsors("")).toEqual([]);
    expect(parseSpacSponsors("our sponsor, officers or directors.")).toEqual([]);
  });

  it("reads an appositive legal name including a comma before LLC", () => {
    const rows = parseSpacSponsors(APPOSITIVE);
    expect(rows.map((r) => r.legal_name)).toEqual(["Bluerock Acquisition Holdings II, LLC"]);
    expect(rows[0]?.source).toBe("deterministic");
    expect(APPOSITIVE.includes(rows[0]!.source_span)).toBe(true);
  });

  it("reads a copula legal name", () => {
    expect(parseSpacSponsors(COPULA).map((r) => r.legal_name)).toEqual([
      "Samara Acquisition Sponsor VI Ltd.",
    ]);
  });

  it("reads The Sponsor appositive", () => {
    expect(parseSpacSponsors(THE_SPONSOR).map((r) => r.legal_name)).toEqual([
      "Teucrium Asset Management, LLC",
    ]);
  });

  it("does not treat officer lists or nameless copulas as a hit", () => {
    expect(hasSponsorIdentification(NOISE)).toBe(false);
    expect(parseSpacSponsors(NOISE)).toEqual([]);
  });
});
