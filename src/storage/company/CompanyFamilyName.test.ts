/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { companyFamilyName } from "./CompanyFamilyName";
import { normalizeCompany } from "./CompanyNormalization";

/**
 * Every name below is real — taken from the committed golden S-1 labels, which
 * are hand-verified against filings. Pairs are written as pairs because the
 * whole job of this function is making the two sides agree.
 */
describe("companyFamilyName", () => {
  it("takes a fund vehicle to its house", () => {
    expect(companyFamilyName("WAVE Equity Fund II, L.P.")).toBe("wave-equity");
    expect(companyFamilyName("WAVE Equity Fund, LLC")).toBe("wave-equity");
  });

  it.each([
    ["Chardan", "Chardan Capital Markets LLC"],
    ["Goldman Sachs", "Goldman Sachs & Co. LLC"],
    ["Credit Suisse", "Credit Suisse Securities (USA) LLC"],
    ["EcoR1", "EcoR1 Capital LLC"],
    ["Cantor Fitzgerald", "Cantor Fitzgerald & Co."],
    ["Jefferies", "Jefferies LLC"],
    ["J.P. Morgan Securities", "J.P. Morgan Securities LLC"],
    ["Lucid Capital Markets", "Lucid Capital Markets LLC"],
    ["Craig-Hallum Capital Group", "Craig-Hallum Capital Group LLC"],
    ["D. Boral Capital", "D. Boral Capital LLC"],
    ["Evercore Group", "Evercore Group L.L.C."],
    ["EarlyBirdCapital", "EarlyBirdCapital, Inc."],
    ["Keefe, Bruyette & Woods", "Keefe, Bruyette & Woods, Inc."],
    ["Dawson James Securities", "Dawson James Securities, Inc."],
    ["Citizens JMP Securities", "Citizens JMP Securities, LLC"],
    ["Bluerock Acquisition Holdings", "Bluerock Acquisition Holdings II, LLC"],
  ])("unifies %s with %s", (short, long) => {
    expect(companyFamilyName(short)).toBe(companyFamilyName(long));
    expect(companyFamilyName(short)).not.toBe("");
  });

  it("strips series markers, sponsors and legal forms together", () => {
    expect(companyFamilyName("Churchill Sponsor XIII LLC")).toBe("churchill");
    expect(companyFamilyName("Longitude Venture Partners V, L.P.")).toBe("longitude");
    expect(companyFamilyName("Curnes Fund 2001")).toBe("curnes");
    expect(companyFamilyName("CQ Invest I LLC")).toBe("cq");
  });

  it("keeps an ampersand's words and drops the conjunction it strands", () => {
    // `& Co.` folds to `and co`; dropping the legal form must not leave `and`.
    expect(companyFamilyName("Goldman Sachs & Co. LLC")).toBe("goldman-sachs");
    expect(companyFamilyName("Keefe, Bruyette & Woods, Inc.")).toBe("keefe-bruyette-and-woods");
  });

  it("folds a diacritic to its base letter rather than breaking the word", () => {
    // The mark used to become a space, splitting `Coöperatieve` into `co` —
    // read as a legal form — plus a stray `peratieve`.
    expect(companyFamilyName("Coöperatieve Gilde Healthcare VG VI U.A.")).toBe(
      "cooperatieve-gilde-healthcare-vg"
    );
  });

  it("folds Latin letters that carry the mark inside the glyph", () => {
    // NFD does not decompose these, so an NFD-only fold left them for the ASCII
    // filter, which turned `Søren` into `s ren` and DELETED the `Ł` in
    // `Łukasz`. A name silently missing a letter is a different name.
    expect(companyFamilyName("Søren Skou Holdings LLC")).toBe("soren-skou");
    expect(companyFamilyName("Søren Skou Holdings LLC")).toBe(companyFamilyName("Soren Skou"));
    expect(companyFamilyName("Łukasz Nowak Capital")).toBe("lukasz-nowak");
    expect(companyFamilyName("Łukasz Nowak Capital")).toBe(companyFamilyName("Lukasz Nowak"));
    expect(companyFamilyName("Ærø Invest ApS")).toBe("aero");
  });

  it("drops a bloc prefix and a parenthetical jurisdiction", () => {
    expect(companyFamilyName("Entities affiliated with Osage University Partners")).toBe(
      "osage-university"
    );
    expect(companyFamilyName("B&R Technology Sponsor LLC (Cayman)")).toBe("b-and-r-technology");
  });

  it("is token-exact, so a name merely starting with a vehicle word survives", () => {
    // `Fundamental` begins with `Fund`; a prefix rule would gut it.
    expect(companyFamilyName("Fundamental Global Inc.")).toBe("fundamental-global");
  });

  it("never strips a name down to nothing", () => {
    // Every token is droppable and the name identifies no house, so it is kept
    // whole rather than resolving to "" and colliding with every other such name.
    expect(companyFamilyName("Fund III")).toBe("fund-iii");
    expect(companyFamilyName("Holdings")).toBe("holdings");
  });

  it("returns empty for empty input", () => {
    expect(companyFamilyName("")).toBe("");
    expect(companyFamilyName(null)).toBe("");
    expect(companyFamilyName(undefined)).toBe("");
    expect(companyFamilyName("   ")).toBe("");
  });

  it("is coarser than the identity hash, and must not be used as one", () => {
    // The contract that keeps the two apart: entity identity keeps what family
    // grouping throws away. Two funds of one family are ONE family and TWO
    // companies.
    const a = "WAVE Equity Fund II, L.P.";
    const b = "WAVE Equity Fund III, LLC";
    expect(companyFamilyName(a)).toBe(companyFamilyName(b));
    expect(normalizeCompany(a)!.company_hash_id).not.toBe(normalizeCompany(b)!.company_hash_id);
  });
});
