/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  PhoneImport,
  normalizeInternationalPhone,
  regionCodeFor,
} from "./PhoneNormalization";

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

/**
 * The international fallback, and the line it refuses to cross.
 *
 * EDGAR's phone field is free text, so a foreign filer writes the country code
 * into it bare and the number fails as too-long under any region. What makes
 * the recovery safe is `valid` rather than `possible`: `possible` says only
 * that the digit count is allowed somewhere in a country's plan, which is a
 * property a mistyped US number satisfies by accident.
 */
describe("normalizeInternationalPhone", () => {
  it("recovers a number that carries its own country code", () => {
    // Switzerland, with the trunk 0 EDGAR filers leave in.
    expect(normalizeInternationalPhone("41-0-91-941-8758")?.international_number).toBe(
      "+41 91 941 87 58"
    );
    expect(normalizeInternationalPhone("44 0 7770 637030")?.international_number).toBe(
      "+44 7770 637030"
    );
    expect(normalizeInternationalPhone("852-35833340")?.international_number).toBe(
      "+852 3583 3340"
    );
  });

  it("records the DETECTED country, not the one we guessed", () => {
    expect(normalizeInternationalPhone("41-0-91-941-8758")?.country_code).toBe("CH");
    expect(normalizeInternationalPhone("353 21 487 6672")?.country_code).toBe("IE");
  });

  it("refuses a number that is merely possible, not valid", () => {
    // `412-567-13254` is `possible` in Switzerland and every one of its ten
    // single-digit deletions is a VALID US number — there is nothing to choose
    // between them, and inventing one would store a real number belonging to
    // someone else.
    expect(normalizeInternationalPhone("412-567-13254")).toBeUndefined();
    expect(normalizeInternationalPhone("604-8868-5394")).toBeUndefined();
    expect(normalizeInternationalPhone("(760) 602-19")).toBeUndefined();
  });

  it("refuses what is not a number at all", () => {
    expect(normalizeInternationalPhone("000-000-0000")).toBeUndefined();
    expect(normalizeInternationalPhone("917")).toBeUndefined();
    expect(normalizeInternationalPhone("")).toBeUndefined();
    expect(normalizeInternationalPhone("no digits here")).toBeUndefined();
  });
});

describe("normalizePhone country recording", () => {
  it("records the detected country when the raw value overrides the region", () => {
    // Asked for US, given a number that says it is Swiss. The number wins.
    const phone = normalizePhone({ phone_raw: "+41 91 941 87 58", country_code: "US" });
    expect(phone?.country_code).toBe("CH");
  });

  it("keeps the requested region when the detected one is not a country", () => {
    // libphonenumber answers "001" for non-geographic ranges (UIFN toll-free,
    // satellite), and `country_code` is a fixed-width alpha-2 — storing that
    // would fail the write. Asserted on the helper rather than through a real
    // number, because no `+800` value in the corpus even parses as possible,
    // so a fixture would pass without exercising the guard at all.
    expect(regionCodeFor({ regionCode: "001" }, "US")).toBe("US");
    expect(regionCodeFor({ regionCode: undefined }, "GB")).toBe("GB");
    expect(regionCodeFor({ regionCode: "CH" }, "US")).toBe("CH");
  });
});
