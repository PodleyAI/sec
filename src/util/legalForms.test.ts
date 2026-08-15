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
    const alts = legalFormProseSuffixAlternation.split("|");
    const incorporated = alts.findIndex((a) => /\[Ii\]\[Nn\]\[Cc\]\[Oo\]/.test(a));
    const inc = alts.findIndex((a) => a === "[Ii][Nn][Cc]\\.?");
    expect(incorporated).toBeGreaterThanOrEqual(0);
    expect(inc).toBeGreaterThan(incorporated);
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
