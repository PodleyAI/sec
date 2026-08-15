/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  LEGAL_FORMS,
  legalFormFoldedTokens,
  legalFormIdentityCanonical,
  legalFormIdentityStrip,
  legalFormProseSuffixAlternation,
  legalFormTrailingCanonical,
} from "./legalForms";

/**
 * Split the alternation on its TOP-LEVEL `|` only. A word-shaped spelling now
 * contributes a grouped alternative (`\bCorp(?:oration|ORATION)\.?(?!…)`
 * shape), so a plain `.split("|")` tears those groups in half and yields
 * unparseable fragments.
 */
function splitTopLevelAlternatives(pattern: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === "\\") {
      current += ch + (pattern[i + 1] ?? "");
      i += 1;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "|" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

describe("LEGAL_FORMS", () => {
  it("is the single vocabulary every consumer derives from", () => {
    expect(LEGAL_FORMS.length).toBeGreaterThan(10);
    const canonicals = LEGAL_FORMS.map((form) => form.canonical);
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });

  it("folds dotted and verbose spellings to the tokens family-name stripping uses", () => {
    expect([...legalFormFoldedTokens].toSorted()).toEqual([
      "ab",
      "ag",
      "aps",
      "as",
      "bv",
      "co",
      "company",
      "corp",
      "corporation",
      "gmbh",
      "gp",
      "inc",
      "incorporated",
      "kg",
      "limited",
      "llc",
      "lllp",
      "llp",
      "lp",
      "ltd",
      "nv",
      "oy",
      "pa",
      "pc",
      "plc",
      "pllc",
      "pte",
      "pty",
      "sa",
      "sarl",
      "spc",
      "trust",
      "ua",
    ]);
  });

  it("builds a case-folded prose suffix that matches without an i flag", () => {
    const re = new RegExp(`(?:${legalFormProseSuffixAlternation})$`);
    for (const suffix of [
      "Inc.",
      "inc.",
      "Incorporated",
      "L.L.C.",
      "l.l.c.",
      "LLC",
      "L.P.",
      "lp",
      "G.P.",
      "gp",
      "Plc",
      "PLC",
      "N.V.",
      "Ltd",
      "GmbH",
    ] as const) {
      expect(re.test(suffix), suffix).toBe(true);
    }
    expect(re.test("Holdings")).toBe(false);
    expect(re.test("Partners")).toBe(false);
  });

  it("puts longer spellings first so Incorporated wins over Inc", () => {
    // The property is about ORDER OF ALTERNATION, which a regex engine resolves
    // by trying alternatives left to right — so assert it the way the engine
    // reads it: the index of the first alternative that matches the spelling.
    // Spelling the patterns out literally (`"[Ii][Nn][Cc]\\.?"`) pinned an
    // implementation detail instead, and broke the moment word-shaped
    // spellings stopped being letter-folded.
    const alts = splitTopLevelAlternatives(legalFormProseSuffixAlternation);
    const firstMatching = (spelling: string): number =>
      alts.findIndex((alt) => new RegExp(`^(?:${alt})$`).test(spelling));

    const incorporated = firstMatching("Incorporated");
    const inc = firstMatching("Inc.");
    expect(incorporated).toBeGreaterThanOrEqual(0);
    expect(inc).toBeGreaterThan(incorporated);

    const corporation = firstMatching("Corporation");
    const corp = firstMatching("Corp.");
    expect(corporation).toBeGreaterThanOrEqual(0);
    expect(corp).toBeGreaterThan(corporation);

    // The long multi-word spelling outranks the abbreviation it expands.
    const limitedLiabilityCompany = firstMatching("Limited Liability Company");
    const llc = firstMatching("LLC");
    expect(limitedLiabilityCompany).toBeGreaterThanOrEqual(0);
    expect(llc).toBeGreaterThan(limitedLiabilityCompany);
  });

  it("keeps word-shaped forms case-sensitive and short abbreviations case-folded", () => {
    const re = new RegExp(`(?:${legalFormProseSuffixAlternation})$`);

    // Lowercased, these words are not a party name — they are the jurisdiction
    // clause that FOLLOWS one ("a Delaware corporation", "a German company"),
    // which is exactly what the folded alternation used to return as the
    // merger counterparty.
    for (const suffix of [
      "corporation",
      "company",
      "limited",
      "incorporated",
      "trust",
    ] as const) {
      expect(re.test(suffix), suffix).toBe(false);
    }

    // Filing capitalisation and the ALL-CAPS variant filers shout in exhibits.
    for (const suffix of [
      "Corporation",
      "CORPORATION",
      "Company",
      "COMPANY",
      "Limited",
      "LIMITED",
      "Incorporated",
      "INCORPORATED",
      "Trust",
      "TRUST",
    ] as const) {
      expect(re.test(suffix), suffix).toBe(true);
    }

    // Short abbreviations stay folded: filers really do write "Barclays plc"
    // and "TARGET HOLDINGS, INC." alike.
    for (const suffix of ["Inc.", "INC.", "inc.", "plc", "Plc", "PLC", "ltd", "LLC"] as const) {
      expect(re.test(suffix), suffix).toBe(true);
    }
  });

  it("does not match a legal form spelled inside a longer word", () => {
    const re = new RegExp(legalFormProseSuffixAlternation);
    // `AG` at the head of "Agreement" is the shape that made
    // "Business Combination Ag" read as a legal name; `Inc` at the head of
    // "Incorporation" and `Co` at the head of "Combination" are the same bug
    // one form over. The leading `\b` and the trailing `(?![A-Za-z])` bracket
    // each alternative so none of them fire.
    expect(re.test("Business Combination Agreement")).toBe(false);
    expect(re.test("Incorporation by reference")).toBe(false);
    expect(re.test("Corporate governance")).toBe(false);
  });

  it("maps a trailing spelling to its canonical copy form", () => {
    const canonicalOf = (name: string): string | undefined => {
      for (const [re, canonical] of legalFormTrailingCanonical) {
        if (re.test(name)) return canonical;
      }
      return undefined;
    };
    expect(canonicalOf("Bar LLC")).toBe("LLC");
    expect(canonicalOf("Bar L.L.C.")).toBe("LLC");
    expect(canonicalOf("Bar Incorporated")).toBe("Inc");
    expect(canonicalOf("Bar Inc.")).toBe("Inc");
    expect(canonicalOf("Bar G.P.")).toBe("GP");
    expect(canonicalOf("Bar Limited Liability Company")).toBe("LLC");
    expect(canonicalOf("Bar Partners")).toBeUndefined();
  });

  it("strips Inc/Corp/Ltd/Co from identity and keeps LLC/LP/GP as canonical", () => {
    expect(legalFormIdentityStrip).toEqual([
      "INCORPORATED",
      "INC",
      "CORPORATION",
      "CORP",
      "LIMITED",
      "LTD",
      "COMPANY",
      "CO",
      "PTE",
    ]);
    const canonicals = legalFormIdentityCanonical.map(([, canonical]) => canonical);
    expect(canonicals).toContain("LLC");
    expect(canonicals).toContain("LP");
    expect(canonicals).toContain("GP");
    expect(canonicals).toContain("LLP");
    expect(canonicals).not.toContain("Inc");
  });
});
