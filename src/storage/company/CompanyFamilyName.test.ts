/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { companyFamilyName, isCompanyFamilyPrefix } from "./CompanyFamilyName";
import { normalizeCompany } from "./CompanyNormalization";

/**
 * Every name below is real — taken from the committed golden S-1 labels, which
 * are hand-verified against filings. Pairs are written as pairs because the
 * whole job of this function is making the two sides agree.
 */
describe("companyFamilyName", () => {
  it("takes a fund vehicle to its house", () => {
    // The series marker and legal form go; `Fund` stays, because a
    // business-line word can distinguish two real houses.
    expect(companyFamilyName("WAVE Equity Fund II, L.P.")).toBe("wave-equity-fund");
    expect(companyFamilyName("WAVE Equity Fund, LLC")).toBe("wave-equity-fund");
  });

  it("keeps business-line words, leaving those joins to an alias", () => {
    // `Acme Capital` and `Acme Ventures` can be unrelated firms; folding both
    // to `acme` would merge them with no evidence and no way to tell after.
    expect(companyFamilyName("Acme Capital LLC")).toBe("acme-capital");
    expect(companyFamilyName("Acme Ventures LLC")).toBe("acme-ventures");
    expect(companyFamilyName("Acme Capital LLC")).not.toBe(companyFamilyName("Acme Ventures LLC"));
    // Chardan is the rare real join, and it is an alias's job, not this one's.
    expect(companyFamilyName("Chardan Capital Markets LLC")).toBe("chardan-capital-markets");
    expect(companyFamilyName("Chardan")).toBe("chardan");
    // Holdings is a business-line word, not a legal form. The model used to
    // drop it from a "common name"; keyed off the legal name, the house stays.
    expect(companyFamilyName("26 Capital Holdings LLC")).toBe("26-capital-holdings");
    expect(companyFamilyName("26 Capital")).toBe("26-capital");
    expect(companyFamilyName("26 Capital Holdings LLC")).not.toBe(companyFamilyName("26 Capital"));
  });

  it.each([
    ["Goldman Sachs", "Goldman Sachs & Co. LLC"],
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
    expect(companyFamilyName("Churchill Sponsor XIII LLC")).toBe("churchill-sponsor");
    expect(companyFamilyName("Longitude Venture Partners V, L.P.")).toBe(
      "longitude-venture-partners"
    );
    expect(companyFamilyName("Curnes Fund 2001")).toBe("curnes-fund");
    expect(companyFamilyName("CQ Invest I LLC")).toBe("cq-invest");
    expect(companyFamilyName("Acme Sponsor G.P.")).toBe("acme-sponsor");
    expect(companyFamilyName("Acme Sponsor GP")).toBe("acme-sponsor");
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
    expect(companyFamilyName("Søren Skou LLC")).toBe("soren-skou");
    expect(companyFamilyName("Søren Skou LLC")).toBe(companyFamilyName("Soren Skou"));
    expect(companyFamilyName("Łukasz Nowak")).toBe("lukasz-nowak");
    expect(companyFamilyName("Łukasz Nowak")).toBe(companyFamilyName("Lukasz Nowak"));
    expect(companyFamilyName("Ærø ApS")).toBe("aero");
  });

  it("drops a bloc prefix and a parenthetical jurisdiction", () => {
    expect(companyFamilyName("Entities affiliated with Osage University Partners")).toBe(
      "osage-university-partners"
    );
    expect(companyFamilyName("B&R Technology Sponsor LLC (Cayman)")).toBe(
      "b-and-r-technology-sponsor"
    );
  });

  it("is token-exact, so a name merely containing a legal form survives", () => {
    // A substring rule would gut both of these real names: `DirectorCo` ends in
    // `co` and `Quantum` ends in `ua`, and in neither case is that a legal form
    // — it is the house name.
    expect(companyFamilyName("DirectorCo")).toBe("directorco");
    expect(companyFamilyName("Entities affiliated with Cambridge Quantum")).toBe(
      "cambridge-quantum"
    );
    expect(companyFamilyName("Fundamental Global Inc.")).toBe("fundamental-global");
  });

  it("keeps the series marker when dropping it leaves a generic vehicle word", () => {
    // `fund` names no house, so `fund` as a family key is a collision waiting to
    // happen: EVERY sponsor's "Fund II" would land in it. The numeral is the
    // only distinguishing token such a name has, so it is the one case where a
    // series marker is kept — an under-merge (two families, one alias to join
    // them) rather than an over-merge, which silently attributes one house's
    // deals to another and leaves no trace.
    expect(companyFamilyName("Fund III")).toBe("fund-iii");
    expect(companyFamilyName("Fund II, L.P.")).toBe("fund-ii");
    expect(companyFamilyName("Fund III")).not.toBe(companyFamilyName("Fund II, L.P."));
    expect(companyFamilyName("Partners III LLC")).not.toBe(companyFamilyName("Partners IV LLC"));
    expect(companyFamilyName("Ventures 2021")).not.toBe(companyFamilyName("Ventures 2022"));
    // Single token, nothing to drop.
    expect(companyFamilyName("Holdings")).toBe("holdings");
  });

  it("still drops the series marker when a real house name survives it", () => {
    // The floor is narrow on purpose: one generic word left standing, not two,
    // and not a name that carries any house token at all. These are the joins
    // the family tier exists to make, and they must keep working.
    expect(companyFamilyName("Churchill Sponsor XIII LLC")).toBe("churchill-sponsor");
    expect(companyFamilyName("Churchill Sponsor XIII LLC")).toBe(
      companyFamilyName("Churchill Sponsor XIV LLC")
    );
    expect(companyFamilyName("WAVE Equity Fund II, L.P.")).toBe("wave-equity-fund");
    expect(companyFamilyName("Curnes Fund 2001")).toBe("curnes-fund");
  });

  it("drops a series marker in the MIDDLE of the name, not only at the end", () => {
    // All three are real names from the committed golden labels. A sponsor
    // serializes a vehicle wherever the name reads best, and a tail-only strip
    // leaves consecutive vehicles of one house in different families.
    expect(companyFamilyName("Southern Cross Acquisition I Sponsor Corp.")).toBe(
      "southern-cross-acquisition-sponsor"
    );
    expect(companyFamilyName("Southern Cross Acquisition I Sponsor Corp.")).toBe(
      companyFamilyName("Southern Cross Acquisition II Sponsor Corp.")
    );
    expect(companyFamilyName("Osprey Acquisition III, Sponsor LLC")).toBe(
      "osprey-acquisition-sponsor"
    );
    expect(companyFamilyName("CGC III Sponsor DirectorCo LLC")).toBe("cgc-sponsor-directorco");
  });

  it("does not mistake a real word for an interior series marker", () => {
    // The tail rule accepts any run of `ivxlcdm` because a name almost never
    // ENDS in one of these; mid-name that reasoning is gone, so the token has to
    // be a well-formed numeral. Every word here passes the loose character test
    // and would be deleted from the middle of the name by it.
    expect(companyFamilyName("Blue Civil Holdings")).toBe("blue-civil-holdings");
    expect(companyFamilyName("Vivid Mild Ventures")).toBe("vivid-mild-ventures");
    expect(companyFamilyName("Acme Dim Partners")).toBe("acme-dim-partners");
    // A bare interior NUMBER is part of the name, not a serialization of it —
    // unlike a trailing year (`Curnes Fund 2001`), which still strips.
    expect(companyFamilyName("Route 66 Ventures")).toBe("route-66-ventures");
  });

  it("leaves a numeral that is the house's own name alone", () => {
    // First position is the name itself, and last position already answered to
    // the tail rule (including the generic-vehicle floor), so neither is
    // reachable by the interior strip.
    expect(companyFamilyName("V Capital Partners")).toBe("v-capital-partners");
    expect(companyFamilyName("Fund III")).toBe("fund-iii");
    expect(companyFamilyName("III LLC")).toBe("iii-llc");
  });

  it("never strips a name down to nothing", () => {
    expect(companyFamilyName("Fund III")).not.toBe("");
    expect(companyFamilyName("Holdings")).not.toBe("");
    expect(companyFamilyName("III LLC")).not.toBe("");
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

describe("isCompanyFamilyPrefix", () => {
  it("treats a brand stub as a prefix of the full legal name", () => {
    // Live S-1: the model emitted both "Cantor" and "Cantor Fitzgerald & Co."
    // as underwriters. The short one is a brand echo, not a second house.
    expect(isCompanyFamilyPrefix("Cantor", "Cantor Fitzgerald & Co.")).toBe(true);
    expect(isCompanyFamilyPrefix("Cantor Fitzgerald & Co.", "Cantor")).toBe(false);
  });

  it("does not treat two vehicles of one house as prefixes of each other", () => {
    // Inc vs Limited (or LLC vs & Co.) collapse to the same family tokens.
    // Dropping either would merge two legal entities that share a family.
    expect(
      isCompanyFamilyPrefix("Citigroup Global Markets Inc.", "Citigroup Global Markets Limited")
    ).toBe(false);
    expect(isCompanyFamilyPrefix("Goldman Sachs & Co. LLC", "Goldman Sachs LLC")).toBe(false);
    expect(isCompanyFamilyPrefix("Goldman Sachs LLC", "Goldman Sachs & Co. LLC")).toBe(false);
  });
});

describe("EDGAR's state-of-incorporation suffix", () => {
  it("keeps one sponsor's vehicles in one family", () => {
    // EDGAR appends the marker only to the vehicles it needs to disambiguate,
    // so the suffixed and unsuffixed names of one house split in two.
    const churchill = [
      "Churchill Capital Corp XII",
      "Churchill Capital Corp IX/Cayman",
      "Churchill Capital Corp X/Cayman",
      "Churchill Capital Corp V",
    ].map(companyFamilyName);
    expect(new Set(churchill).size).toBe(1);
    expect(churchill[0]).toBe("churchill-capital");
  });

  it("handles the spaced and doubled-slash spellings", () => {
    expect(companyFamilyName("Gores Holdings X, Inc. / CI")).toBe(
      companyFamilyName("Gores Holdings IX, Inc.")
    );
    expect(companyFamilyName("Ionetix Corp / DE /")).toBe("ionetix");
    expect(companyFamilyName("Melar Acquisition Corp. I/Cayman")).toBe("melar-acquisition");
  });

  it("never empties a name that is nothing but the marker", () => {
    expect(companyFamilyName("/DE")).not.toBe("");
  });
});

describe("CJK names are not folded into a family key", () => {
  it("wipes a letterless-to-ASCII Chinese legal name rather than inventing a romanization", () => {
    // Persist already observes CJK without a family (Q13). Folding CJK into a
    // pinyin key would re-key the family tier; leaving it empty is the skip.
    expect(companyFamilyName("中信证券股份有限公司")).toBe("");
    expect(companyFamilyName("[●]")).toBe("");
  });
});
