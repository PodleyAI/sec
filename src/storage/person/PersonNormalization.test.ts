/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { normalizePerson, PersonImport } from "./PersonNormalization";

describe("PersonNormalization", () => {
  describe("cleanPerson", () => {
    it("should return undefined for null input", () => {
      expect(normalizePerson(null)).toBeUndefined();
    });

    it("should return undefined when first name is missing", () => {
      const input: PersonImport = { name: "Smith" };
      expect(normalizePerson(input)).toBeUndefined();
    });

    it("should return undefined when last name is missing", () => {
      const input: PersonImport = { name: "John" };
      expect(normalizePerson(input)).toBeUndefined();
    });

    it("should normalize basic name components", () => {
      const input: PersonImport = { name: "john smith" };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.last).toBe("Smith");
      expect(result!.person_hash_id).toBeDefined();
    });

    it("should handle middle names", () => {
      const input: PersonImport = { name: "john william smith" };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.middle).toBe("William");
      expect(result!.last).toBe("Smith");
    });

    it("should normalize name suffixes", () => {
      const input: PersonImport = { name: "john smith jr." };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      // Suffix period is stripped so "Jr." and "Jr" resolve to the same person.
      expect(result!.suffix).toBe("Jr");
    });

    it("should normalize Roman numeral suffixes", () => {
      const input: PersonImport = { name: "john smith 2nd" };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.suffix).toBe("Jr");
    });

    it("should handle professional titles", () => {
      const input: PersonImport = { name: "john smith dr." };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.title).toBe("Dr.");
    });

    it("should parse full name when individual components are missing", () => {
      const input: PersonImport = { name: "John William Smith Jr" };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.middle).toBe("William");
      expect(result!.last).toBe("Smith");
      expect(result!.suffix).toBe("Jr");
    });

    it("should parse full name with multiple middle names", () => {
      const input: PersonImport = { name: "Mary Jane Watson Smith" };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("Mary");
      expect(result!.middle).toBe("Jane Watson");
      expect(result!.last).toBe("Smith");
    });

    it("should handle names with apostrophes and hyphens", () => {
      const input: PersonImport = { name: "mary-jane o'connor" };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("Mary-Jane");
      expect(result!.last).toBe("O'Connor");
    });

    // The resolver keys on first|middle|last|suffix, so these variants MUST
    // produce identical parts or the same person splits into two canonical rows.
    const key = (name: string): string => {
      const r = normalizePerson({ name });
      return r ? `${r.first}|${r.middle ?? ""}|${r.last}|${r.suffix ?? ""}` : "(undefined)";
    };

    it("collapses a curly vs straight apostrophe to one name", () => {
      expect(key("Frank D’Angelo")).toBe(key("Frank D'Angelo"));
      // and the letter after the apostrophe is cased consistently
      expect(normalizePerson({ name: "Frank D’Angelo" })!.last).toBe("D'Angelo");
    });

    it("collapses initial and suffix period variants to one name", () => {
      expect(key("Richard J. Boyle, Jr.")).toBe(key("Richard J Boyle Jr"));
      expect(key("Frank Martire, III")).toBe(key("Frank Martire III"));
    });

    it("should handle del xxxx", () => {
      const input: PersonImport = { name: "Michel del Buono" };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("Michel");
      expect(result!.last).toBe("del Buono");
      expect(result!.person_hash_id).toBe("michel-del-buono");
    });

    it("should handle extra whitespace", () => {
      const input: PersonImport = { name: "  john  william    smith    " };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.middle).toBe("William");
      expect(result!.last).toBe("Smith");
    });

    it("should generate consistent hash IDs for identical persons", () => {
      const input1: PersonImport = { name: "John Smith" };
      const input2: PersonImport = { name: "john SMITH" };

      const result1 = normalizePerson(input1);
      const result2 = normalizePerson(input2);

      expect(result1!.person_hash_id).toBe(result2!.person_hash_id);
    });

    it("should generate different hash IDs for different persons", () => {
      const input1: PersonImport = { name: "John Smith" };
      const input2: PersonImport = { name: "Jane Smith" };

      const result1 = normalizePerson(input1);
      const result2 = normalizePerson(input2);

      expect(result1!.person_hash_id).not.toBe(result2!.person_hash_id);
    });

    it("should handle empty strings as null", () => {
      const input: PersonImport = { name: "   " };

      const result = normalizePerson(input);
      expect(result).toBeUndefined(); // Should fail because first name is empty
    });

    it("should normalize common professional titles", () => {
      const titles = ["mr.", "Mrs", "DR", "Prof.", "CEO", "president"];

      for (const title of titles) {
        const input: PersonImport = { name: `John Smith ${title}` };

        const result = normalizePerson(input);
        expect(result).toBeDefined();
        expect(result!.title).toBeDefined();
      }
    });

    it("should handle CIK and CRD fields", () => {
      const input: PersonImport = {
        name: "John Smith",
        cik: 123456,
        crd: "98765",
      };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.last).toBe("Smith");
      expect(result!.cik).toBe(123456);
      expect(result!.crd).toBe("98765");
    });

    it("should handle null CIK and CRD fields", () => {
      const input: PersonImport = {
        name: "John Smith",
        cik: null,
        crd: null,
      };

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.last).toBe("Smith");
      expect(result!.cik).toBe(null);
      expect(result!.crd).toBe(null);
    });
  });

  describe("credentials vs generational suffixes", () => {
    // A credential says how ONE filing annotated a person; a generational
    // suffix says WHICH person. Only the latter may reach the identity key.
    it("keeps a credential out of the hash so the same person does not split", () => {
      const bare = normalizePerson({ name: "Troy A. Hering" })!;
      const credentialed = normalizePerson({ name: "Troy A. Hering CPA" })!;
      expect(credentialed.person_hash_id).toBe(bare.person_hash_id);
      expect(credentialed.suffix).toBeNull();
      expect(credentialed.credentials).toBe("Cpa"); // fixCase:1 title-cases the display form
      expect(credentialed.last).toBe("Hering");
    });

    it("collapses comma-written credentials onto the bare name", () => {
      for (const [bare, annotated] of [
        ["Isaac Manke", "Isaac Manke, Ph.D."],
        ["Gbola Amusa", "Gbola Amusa, M.D., CFA"],
        ["Andrew Lam", "Andrew Lam, PharmD"],
      ]) {
        expect(normalizePerson({ name: annotated })!.person_hash_id).toBe(
          normalizePerson({ name: bare })!.person_hash_id
        );
      }
    });

    it("STILL separates a generational suffix — father and son are two people", () => {
      const father = normalizePerson({ name: "John Smith" })!;
      const son = normalizePerson({ name: "John Smith Jr." })!;
      expect(son.person_hash_id).not.toBe(father.person_hash_id);
      expect(son.suffix).toBe("Jr");
    });

    it("splits a name carrying both kinds at once", () => {
      const both = normalizePerson({ name: "John Smith Jr., CPA" })!;
      expect(both.suffix).toBe("Jr");
      expect(both.credentials).toBe("Cpa");
      // The credential is invisible to identity, so it matches the plain junior
      // and not the plain senior.
      expect(both.person_hash_id).toBe(normalizePerson({ name: "John Smith Jr." })!.person_hash_id);
      expect(both.person_hash_id).not.toBe(normalizePerson({ name: "John Smith" })!.person_hash_id);
    });
  });

  describe("a parenthesized nickname is identity-bearing", () => {
    // Unlike a credential, a nickname is treated as part of who someone is: for
    // the very common given-name + surname pairs an SEC roster holds, it is
    // routinely the only token separating two people.
    it("folds the nickname into `middle`, which is what the resolver keys on", () => {
      const p = normalizePerson({ name: "Yong (David) Yan" })!;
      expect(p.middle).toBe("David");
      // Still exposed separately for display.
      expect(p.nick).toBe("David");
    });

    it("agrees with the same name written without parentheses", () => {
      // These disagreed before: the nickname went to `nick`, which has no column
      // in the resolver's match tuple, so the parenthesized spelling resolved
      // with middle=null and the plain one with middle="David".
      expect(normalizePerson({ name: "Yong (David) Yan" })!.person_hash_id).toBe(
        normalizePerson({ name: "Yong David Yan" })!.person_hash_id
      );
    });

    it("separates a nicknamed person from the bare name", () => {
      expect(normalizePerson({ name: "Yong (David) Yan" })!.person_hash_id).not.toBe(
        normalizePerson({ name: "Yong Yan" })!.person_hash_id
      );
    });

    it("does not overwrite a real middle name", () => {
      const p = normalizePerson({ name: "Robert James (Bob) Smith" })!;
      expect(p.middle).toBe("James");
      expect(p.nick).toBe("Bob");
    });

    it("counts the nickname once — the hash is not 'david-david'", () => {
      expect(normalizePerson({ name: "Yong (David) Yan" })!.person_hash_id).toBe("yong-david-yan");
    });
  });

  describe("organization names (a known lossy input)", () => {
    // normalizePerson parses PERSON names. Feeding it an organization is not a
    // bug in this module — it is a documented property callers must respect,
    // and these cases exist so the losses are visible rather than discovered in
    // a scoring table. They are why `EvalExtractor.personNameFields` is
    // restricted to person-only extractors.

    it("drops a legal-form suffix as if it were a credential, merging distinct entities", () => {
      // "L.P." and "LLC" are the only thing distinguishing these two funds.
      expect(normalizePerson({ name: "WAVE Equity Fund, L.P." })!.person_hash_id).toBe(
        "wave-equity-fund"
      );
      expect(normalizePerson({ name: "WAVE Equity Fund, LLC" })!.person_hash_id).toBe(
        "wave-equity-fund"
      );
    });

    it("reads a roman numeral in a fund name as a generational suffix", () => {
      // "II" becomes a Jr./Sr.-class suffix, so the fund number is not merely
      // lost — it is replaced by a token that means something else entirely.
      expect(normalizePerson({ name: "Wave Equity Partners Fund II, L.P." })!.person_hash_id).toBe(
        "wave-equity-partners-fund-jr"
      );
    });

    it("reorders a corporate name around its suffix", () => {
      // "Inc." is taken for a given name, so the hash leads with it.
      expect(normalizePerson({ name: "BlackRock, Inc." })!.person_hash_id).toBe("inc-blackrock");
    });
  });
});
