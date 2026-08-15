/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  normalizeCompany,
  normalizeCompanyName,
  hasCompanyEnding,
  hasCompanyAnywhere,
  isCompanyEnding,
  CompanyImport,
} from "./CompanyNormalization";

describe("CompanyNormalization", () => {
  describe("normalizeCompany", () => {
    it("should return undefined for null input", () => {
      expect(normalizeCompany(null)).toBeUndefined();
    });

    it("should return undefined for empty string input", () => {
      const input = "";
      expect(normalizeCompany(input)).toBeUndefined();
    });

    it("should return undefined for whitespace-only input", () => {
      const input = "   ";
      expect(normalizeCompany(input)).toBeUndefined();
    });

    it("should normalize basic company name without suffix", () => {
      const input = "Apple Computer";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Apple Computer");
      expect(result!.company_hash_id).toBe("apple-computer");
    });

    it("should strip INC suffix", () => {
      const input = "Apple Computer, Inc";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Apple Computer");
      expect(result!.company_hash_id).toBe("apple-computer");
    });

    it("should strip CORPORATION suffix", () => {
      const input = "Microsoft Corporation";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Microsoft");
      expect(result!.company_hash_id).toBe("microsoft");
    });

    it("should strip INCORPORATED suffix", () => {
      const input = "Microsoft Incorporated";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Microsoft");
      expect(result!.company_hash_id).toBe("microsoft");
    });
    it("should strip double suffixes", () => {
      const input = "Microsoft Corporation Incorporated";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Microsoft");
      expect(result!.company_hash_id).toBe("microsoft");
    });

    it("should not strip LLC suffix", () => {
      const input = "HotCo LLC";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("HotCo LLC");
      expect(result!.company_hash_id).toBe("hotco-llc");
    });

    it("should strip L.L.C. suffix with dots", () => {
      const input = "Something L.L.C.";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Something LLC");
      expect(result!.company_hash_id).toBe("something-llc");
    });

    it("should strip CORPORATION suffix", () => {
      const input = "Tesla Corporation";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Tesla");
      expect(result!.company_hash_id).toBe("tesla");
    });

    it("should strip CORP suffix", () => {
      const input = "Amazon Corp";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Amazon");
      expect(result!.company_hash_id).toBe("amazon");
    });

    it("should strip COMPANY suffix", () => {
      const input = "Ford Motor Company";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Ford Motor");
      expect(result!.company_hash_id).toBe("ford-motor");
    });

    it("should strip LTD suffix", () => {
      const input = "Unilever Ltd";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Unilever");
      expect(result!.company_hash_id).toBe("unilever");
    });

    it("should not strip HOLDINGS suffix", () => {
      const input = "Berkshire Holdings";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Berkshire Holdings");
      expect(result!.company_hash_id).toBe("berkshire-holdings");
    });

    it("should handle case insensitive suffixes, and rename", () => {
      const input = "Apple inc";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Apple Computer");
      expect(result!.company_hash_id).toBe("apple-computer");
    });

    it("should remove punctuation", () => {
      const input = "Johnson & Johnson, Inc.";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Johnson & Johnson");
      expect(result!.company_hash_id).toBe("johnson-and-johnson");
    });

    it("should handle extra whitespace", () => {
      const input = "  Microsoft   Corporation  ";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Microsoft");
      expect(result!.company_hash_id).toBe("microsoft");
    });

    it("should generate consistent hash IDs for equivalent companies", () => {
      const input1 = "Apple Inc";
      const input2 = "apple inc";

      const result1 = normalizeCompany(input1);
      const result2 = normalizeCompany(input2);

      expect(result1!.company_hash_id).toBe(result2!.company_hash_id);
    });

    it("should generate different hash IDs for different companies", () => {
      const input1 = "Apple Inc";
      const input2 = "Microsoft Corp";

      const result1 = normalizeCompany(input1);
      const result2 = normalizeCompany(input2);

      expect(result1!.company_hash_id).not.toBe(result2!.company_hash_id);
    });

    it("should not strip suffix in the middle of a name, and should rename", () => {
      const input = "International Business Machines Corp";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("IBM");
      expect(result!.company_hash_id).toBe("ibm");
    });

    it("should handle company names without recognized suffixes", () => {
      const input = "Berkshire Hathaway";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Berkshire Hathaway");
      expect(result!.company_hash_id).toBe("berkshire-hathaway");
    });

    it("should strip first multiple suffixes", () => {
      const input = "General Motors Corp";

      const result = normalizeCompany(input);
      expect(result).toBeDefined();
      // Should strip "Corp" first as it appears last
      expect(result!.company_name).toBe("General Motors");
      expect(result!.company_hash_id).toBe("general-motors");
    });

    it("canonicalises space-separated 'L L C' to 'LLC'", () => {
      // Regression: canonicalEndings used `\b` inside a template literal,
      // which is the backspace character (U+0008), not a word boundary.
      // It silently no-op'd against every realistic input — punctuated
      // forms only converged because normalizeCompanyName's dot-strip
      // happens to remove the dots first. Space-separated suffixes never
      // converged. After the fix this test passes.
      const result = normalizeCompany("Acme L L C");
      expect(result).toBeDefined();
      expect(result!.company_name).toBe("Acme LLC");
      expect(result!.company_hash_id).toBe("acme-llc");
    });

    it("canonical space-separated 'L L C' shares hash id with 'LLC'", () => {
      const spaced = normalizeCompany("Acme L L C");
      const tight = normalizeCompany("Acme LLC");
      expect(spaced!.company_hash_id).toBe(tight!.company_hash_id);
    });
  });

  describe("normalizeCompanyName typographic folding", () => {
    it("folds a curly apostrophe to ASCII so glyph variants share a key", () => {
      // U+2019 vs U+0027 — the resolver keys on this string, so they must match.
      expect(normalizeCompanyName("Macy’s")).toBe(normalizeCompanyName("Macy's"));
    });

    it("folds en/em dashes to a hyphen", () => {
      expect(normalizeCompanyName("Coca–Cola")).toBe(normalizeCompanyName("Coca-Cola"));
      expect(normalizeCompanyName("Time—Warner")).toBe(normalizeCompanyName("Time-Warner"));
    });

    it("folds smart double quotes to ASCII", () => {
      expect(normalizeCompanyName("The “Acme” Group")).toBe(normalizeCompanyName('The "Acme" Group'));
    });
  });

  describe("diacritics: the company tier does NOT fold", () => {
    // Pinned deliberately, as a gap rather than a behavior anyone should like.
    //
    // `generateCompanyHash` folds accents; `normalizeCompanyName` does not — and
    // the second one is the key that is PERSISTED, on
    // `company_observations.normalized_name`, which the resolver's name fallback
    // and `canonical_company` are keyed on. The hash is a derived slug stored
    // nowhere.
    //
    // Making them agree is a re-key of every company observation ever written,
    // and there is no rebuild path: `sec resolve` re-resolves FROM
    // `normalized_name` instead of recomputing it, so the change would take
    // effect only by re-extracting every company-observing form. This test
    // exists so that fold cannot be added as a one-line change with no
    // migration — if you are here because it failed, the accompanying work is a
    // re-normalizing `ResolveObservationsTask` (or a full re-extraction), not a
    // deleted assertion.
    const accented = "Søren Skou Holdings LLC";
    const plain = "Soren Skou Holdings LLC";

    it("keeps two spellings of one company as two persisted keys", () => {
      expect(normalizeCompanyName(accented)).not.toBe(normalizeCompanyName(plain));
      expect(normalizeCompany(accented)!.company_name).not.toBe(
        normalizeCompany(plain)!.company_name
      );
    });

    it("folds them in the derived slug, which nothing persists", () => {
      expect(normalizeCompany(accented)!.company_hash_id).toBe(
        normalizeCompany(plain)!.company_hash_id
      );
    });
  });

  describe("endings are matched as literals, not as patterns", () => {
    // `[related person is an entity]` was interpolated straight into
    // `new RegExp("\\b" + ending + "\\b$")`, where its brackets are a CHARACTER
    // CLASS. `\b[related person is an entity]\b$` matched — and deleted — the
    // final single-letter word of any name drawn from {r,e,l,a,t,d,p,s,o,n,i,y}.
    it("keeps a trailing series marker on the name", () => {
      expect(normalizeCompanyName("Churchill Capital Corp I")).toBe("Churchill Capital Corp I");
      expect(normalizeCompanyName("Ajax I")).toBe("Ajax I");
      expect(normalizeCompanyName("CF Acquisition Corp. A")).toBe("CF Acquisition Corp A");
    });

    it("keeps two SPACs of one series apart", () => {
      // Two real, distinct registrants: CIK 1819848 (de-SPACed into Joby) and
      // CIK 1828108 (into Hippo). They shared one canonical identity key.
      expect(normalizeCompanyName("Reinvent Technology Partners")).not.toBe(
        normalizeCompanyName("Reinvent Technology Partners Y")
      );
      // `Z` is absent from the accidental class, so this pair never collided —
      // which is what showed the class was the cause rather than the numeral.
      expect(normalizeCompanyName("Reinvent Technology Partners Z")).toBe(
        "Reinvent Technology Partners Z"
      );
    });

    it("still strips the literal placeholder it was there to strip", () => {
      expect(normalizeCompanyName("[related person is an entity]")).toBe("");
      expect(hasCompanyEnding("[related person is an entity]")).toBe(true);
      expect(isCompanyEnding("[related person is an entity]")).toBe(true);
    });

    it("reads a person with a middle initial as a person", () => {
      // hasCompanyEnding is the person-vs-company discriminator on Forms D / C /
      // 1-A / 1-Z / 3 / 4 / 5 / 144, and EDGAR writes Section 16 owners as
      // `LASTNAME FIRSTNAME INITIAL`.
      for (const person of ["Klein Michael S", "Sloan Harry E", "Foley William P"]) {
        expect(hasCompanyEnding(person)).toBe(false);
      }
      expect(hasCompanyEnding("Acme Holdings Inc")).toBe(true);
    });

    it("does not report a company ending inside every multi-word string", () => {
      // The character class contained a literal space, so `\b[ ]\b` matched any
      // string with a space in it.
      expect(hasCompanyAnywhere("Palihapitiya Chamath")).toBe(false);
      expect(hasCompanyAnywhere("Acme Holdings Inc")).toBe(true);
    });
  });

  describe("EDGAR's state-of-incorporation suffix", () => {
    it("does not block the legal-form strip behind it", () => {
      // `\bCORP\b$` cannot reach past an attached `/Cayman`, so the name kept
      // its legal form and minted a second canonical company.
      expect(normalizeCompanyName("Blue Acquisition Corp/Cayman")).toBe(
        normalizeCompanyName("Blue Acquisition Corp")
      );
      expect(normalizeCompanyName("Ionetix Corp / DE /")).toBe("Ionetix");
    });

    it("leaves a slash that is part of the name", () => {
      expect(normalizeCompanyName("A/B Holdings")).toBe("A/B Holdings");
    });
  });
});
