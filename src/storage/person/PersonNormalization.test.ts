//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { normalizePerson, PersonImport } from "./PersonNormalization";

describe("PersonNormalization", () => {
  describe("cleanPerson", () => {
    it("should return undefined for null input", () => {
      expect(normalizePerson(null)).toBeUndefined();
    });

    it("should return undefined when first name is missing", () => {
      const input: PersonImport = "Smith";
      expect(normalizePerson(input)).toBeUndefined();
    });

    it("should return undefined when last name is missing", () => {
      const input: PersonImport = "John";
      expect(normalizePerson(input)).toBeUndefined();
    });

    it("should normalize basic name components", () => {
      const input: PersonImport = "john smith";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.last).toBe("Smith");
      expect(result!.person_hash_id).toBeDefined();
    });

    it("should handle middle names", () => {
      const input: PersonImport = "john william smith";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.middle).toBe("William");
      expect(result!.last).toBe("Smith");
    });

    it("should normalize name suffixes", () => {
      const input: PersonImport = "john smith jr.";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.suffix).toBe("Jr.");
    });

    it("should normalize Roman numeral suffixes", () => {
      const input: PersonImport = "john smith 2nd";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.suffix).toBe("Jr.");
    });

    it("should handle professional titles", () => {
      const input: PersonImport = "john smith dr.";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.title).toBe("Dr.");
    });

    it("should parse full name when individual components are missing", () => {
      const input: PersonImport = "John William Smith Jr";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.middle).toBe("William");
      expect(result!.last).toBe("Smith");
      expect(result!.suffix).toBe("Jr.");
    });

    it("should parse full name with multiple middle names", () => {
      const input: PersonImport = "Mary Jane Watson Smith";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("Mary");
      expect(result!.middle).toBe("Jane Watson");
      expect(result!.last).toBe("Smith");
    });

    it("should handle names with apostrophes and hyphens", () => {
      const input: PersonImport = "mary-jane o'connor";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("Mary-Jane");
      expect(result!.last).toBe("O'Connor");
    });

    // it("should remove invalid characters from names", () => {
    //   const input: PersonImport = "john smith123";

    //   const result = normalizePerson(input);
    //   expect(result).toBeDefined();
    //   expect(result!.first).toBe("John");
    //   expect(result!.last).toBe("Smith");
    // });

    it("should handle extra whitespace", () => {
      const input: PersonImport = "  john  william    smith    ";

      const result = normalizePerson(input);
      expect(result).toBeDefined();
      expect(result!.first).toBe("John");
      expect(result!.middle).toBe("William");
      expect(result!.last).toBe("Smith");
    });

    it("should generate consistent hash IDs for identical persons", () => {
      const input1: PersonImport = "John Smith";

      const input2: PersonImport = "john SMITH";

      const result1 = normalizePerson(input1);
      const result2 = normalizePerson(input2);

      expect(result1!.person_hash_id).toBe(result2!.person_hash_id);
    });

    it("should generate different hash IDs for different persons", () => {
      const input1: PersonImport = "John Smith";
      const input2: PersonImport = "Jane Smith";

      const result1 = normalizePerson(input1);
      const result2 = normalizePerson(input2);

      expect(result1!.person_hash_id).not.toBe(result2!.person_hash_id);
    });

    it("should handle empty strings as null", () => {
      const input: PersonImport = "   ";

      const result = normalizePerson(input);
      expect(result).toBeUndefined(); // Should fail because first name is empty
    });

    it("should normalize common professional titles", () => {
      const titles = ["mr.", "Mrs", "DR", "Prof.", "CEO", "president"];

      for (const title of titles) {
        const input: PersonImport = `John Smith ${title}`;

        const result = normalizePerson(input);
        expect(result).toBeDefined();
        expect(result!.title).toBeDefined();
      }
    });
  });
});
