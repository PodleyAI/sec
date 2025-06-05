//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { normalizePhone, PhoneImport } from "./PhoneNormalization";

describe("PhoneNormalization", () => {
  describe("normalizePhone", () => {
    it("should handle null input", () => {
      expect(normalizePhone(null)).toBeUndefined();
    });

    it("should handle empty phone", () => {
      const input: PhoneImport = { phone_raw: "" };
      expect(normalizePhone(input)).toBeUndefined();
    });

    it("should normalize US phone number without country code", () => {
      const input: PhoneImport = { phone_raw: "(555) 123-4567", country_code: "US" };
      const result = normalizePhone(input);

      expect(result).toBeDefined();
      expect(result!.country_code).toBe("US");
      expect(result!.international_number).toBe("+1 555-123-4567");
      expect(result!.type).toBe("unknown");
      expect(result!.raw_phone).toBe("(555) 123-4567");
    });

    it("should normalize US phone number with country code", () => {
      const input: PhoneImport = { phone_raw: "+1 (555) 123-4567", country_code: "US" };
      const result = normalizePhone(input);

      expect(result).toBeDefined();
      expect(result!.country_code).toBe("US");
      expect(result!.international_number).toBe("+1 555-123-4567");
      expect(result!.type).toBe("unknown");
    });

    it("should normalize phone number with extension", () => {
      const input: PhoneImport = { phone_raw: "555-123-4567 x123", country_code: "US" };
      const result = normalizePhone(input);

      expect(result).toBeDefined();
      expect(result!.country_code).toBe("US");
      expect(result!.international_number).toBe("+1 555-123-4567 ext. 123");
      expect(result!.type).toBe("unknown");
    });

    it("should normalize 11-digit US number with leading 1", () => {
      const input: PhoneImport = { phone_raw: "15551234567", country_code: "US" };
      const result = normalizePhone(input);

      expect(result).toBeDefined();
      expect(result!.country_code).toBe("US");
      expect(result!.international_number).toBe("+1 555-123-4567");
      expect(result!.type).toBe("unknown");
    });

    it("should normalize international phone number", () => {
      const input: PhoneImport = { phone_raw: "+44 20 7946 0958", country_code: "GB" };
      const result = normalizePhone(input);

      expect(result).toBeDefined();
      expect(result!.country_code).toBe("GB");
      expect(result!.international_number).toBe("+44 20 7946 0958");
      expect(result!.type).toBe("fixed-line");
    });

    it("should handle phone numbers with various formatting", () => {
      const testCases = [
        {
          input: "555.123.4567",
          expected: { country_code: "US", international_number: "+1 555-123-4567" },
        },
        {
          input: "555-123-4567",
          expected: { country_code: "US", international_number: "+1 555-123-4567" },
        },
        {
          input: "5551234567",
          expected: { country_code: "US", international_number: "+1 555-123-4567" },
        },
        {
          input: "(555) 123-4567",
          expected: { country_code: "US", international_number: "+1 555-123-4567" },
        },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = normalizePhone({ phone_raw: input });
        expect(result).toBeDefined();
        expect(result!.country_code).toBe(expected.country_code);
        expect(result!.international_number).toBe(expected.international_number);
      });
    });

    it("should default to detected type when not specified", () => {
      const input: PhoneImport = { phone_raw: "555-123-4567" };
      const result = normalizePhone(input);

      expect(result).toBeDefined();
      expect(result!.type).toBe("unknown");
    });

    it("should handle invalid phone numbers", () => {
      const invalidInputs = [
        { phone_raw: "123" },
        { phone_raw: "abc" },
        { phone_raw: "555" },
        { phone_raw: "++1234567890" },
        { phone_raw: "000-000-0000" },
        { phone_raw: "0000000000" },
        { phone_raw: "(000) 000-0000" },
      ];

      invalidInputs.forEach((input) => {
        const result = normalizePhone(input);
        expect(result).toBeUndefined();
      });
    });

    it("should generate consistent numbers", () => {
      const input1: PhoneImport = { phone_raw: "(555) 123-4567" };
      const input2: PhoneImport = { phone_raw: "555.123.4567" };

      const result1 = normalizePhone(input1);
      const result2 = normalizePhone(input2);

      expect(result1!.international_number).toBe(result2!.international_number);
    });

    it("should handle extension formats", () => {
      const testCases = [
        { input: "555-123-4567 x123", expected: "123" },
        { input: "555-123-4567 X456", expected: "456" },
        { input: "555-123-4567x789", expected: "789" },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = normalizePhone({ phone_raw: input });
        expect(result).toBeDefined();
        expect(result!.international_number).toBe("+1 555-123-4567 ext. " + expected);
      });
    });
  });
});
