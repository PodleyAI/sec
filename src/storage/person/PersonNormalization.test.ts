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

  // `normalized_first`, `normalized_middle`, `normalized_last` and
  // `normalized_suffix` are derived from the four fields below and are four of
  // the six columns `PersonResolver.personKey` matches on. Changing what lands
  // in any of them re-keys every `canonical_person` row already written at the
  // active `resolver_version`, so these cases are pinned explicitly: the next
  // change to the rules has to show up as a diff here.
  describe("resolver-key fields (frozen without a person resolver version bump)", () => {
    describe("suffix carries credentials as well as generational suffixes", () => {
      it("puts a bare credential in `suffix`, so it reaches the resolver key", () => {
        const credentialed = normalizePerson({ name: "Jane Doe, CPA" })!;
        // Title-cased by `fixCase: 1`; the column stores it verbatim.
        expect(credentialed.suffix).toBe("Cpa");
        expect(credentialed.first).toBe("Jane");
        expect(credentialed.last).toBe("Doe");
      });

      it("splits a credentialed person from the bare name", () => {
        // This over-splitting is the known cost of the current rule, not an
        // accident: "Jane Doe" and "Jane Doe, CPA" are two canonical people.
        // Fixing it means moving the match tuple, which needs a version bump.
        expect(normalizePerson({ name: "Jane Doe, CPA" })!.person_hash_id).not.toBe(
          normalizePerson({ name: "Jane Doe" })!.person_hash_id
        );
      });

      it("keeps every comma-written credential in `suffix`", () => {
        for (const [name, suffix] of [
          ["Troy A. Hering CPA", "Cpa"],
          ["Isaac Manke, Ph.D.", "PhD"],
          ["Gbola Amusa, M.D., CFA", "MD Cfa"],
          ["Andrew Lam, PharmD", "PharmD"],
        ]) {
          expect(normalizePerson({ name })!.suffix).toBe(suffix);
        }
      });

      it("separates a generational suffix — father and son are two people", () => {
        const father = normalizePerson({ name: "John Smith" })!;
        const son = normalizePerson({ name: "John Smith Jr." })!;
        expect(son.suffix).toBe("Jr");
        expect(son.person_hash_id).not.toBe(father.person_hash_id);
      });

      it("joins both kinds into one suffix, generational first", () => {
        const both = normalizePerson({ name: "John Smith Jr., CPA" })!;
        expect(both.suffix).toBe("Jr Cpa");
        expect(both.person_hash_id).not.toBe(
          normalizePerson({ name: "John Smith Jr." })!.person_hash_id
        );
      });
    });

    describe("a parenthesized nickname stays out of `middle`", () => {
      it("leaves `middle` null and reports the nickname only in `nick`", () => {
        const p = normalizePerson({ name: "Yong (David) Yan" })!;
        expect(p.middle).toBeNull();
        expect(p.nick).toBe("David");
      });

      it("matches the bare name — `nick` has no column in the resolver key", () => {
        // `nick` never reaches a `normalized_*` column, so a filing that prints
        // the nickname and an amendment that omits it are one canonical person.
        expect(normalizePerson({ name: "Yong (David) Yan" })!.person_hash_id).toBe(
          normalizePerson({ name: "Yong Yan" })!.person_hash_id
        );
      });

      it("does NOT match the same name written without parentheses", () => {
        // The unparenthesized spelling is a real middle name, so it does reach
        // the key. Folding "(David)" into `middle` would collapse these two —
        // desirable, and gated on a resolver version bump.
        expect(normalizePerson({ name: "Yong (David) Yan" })!.middle).toBeNull();
        expect(normalizePerson({ name: "Yong David Yan" })!.middle).toBe("David");
        expect(normalizePerson({ name: "Yong (David) Yan" })!.person_hash_id).not.toBe(
          normalizePerson({ name: "Yong David Yan" })!.person_hash_id
        );
      });

      it("leaves a real middle name alone alongside a nickname", () => {
        const p = normalizePerson({ name: "Robert James (Bob) Smith" })!;
        expect(p.middle).toBe("James");
        expect(p.nick).toBe("Bob");
      });
    });
  });
});
