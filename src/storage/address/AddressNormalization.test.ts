//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { normalizeAddress } from "./AddressNormalization";

describe("cleanAddress", () => {
  describe("Valid US Addresses", () => {
    it("should clean a basic US address", () => {
      const input = {
        street1: "123 Main St",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result = normalizeAddress(input);

      expect(result).toBeDefined();
      expect(result!.street1).toBe("123 Main St");
      expect(result!.city).toBe("NEW YORK");
      expect(result!.state_or_country).toBe("NY");
      expect(result!.country_code).toBe("US");
      expect(result!.zip).toBe("10001");
      expect(result!.address_hash_id).toBeTypeOf("string");
    });

    it("should normalize US zip codes", () => {
      const input = {
        street1: "123 Main St",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001-1234",
      };

      const result = normalizeAddress(input);
      expect(result!.zip).toBe("10001");
    });

    it("should parse and normalize US street addresses", () => {
      const input = {
        street1: "123 North Main Street",
        street2: "Apt 5B",
        city: "Los Angeles",
        stateOrCountry: "CA",
        zipCode: "90210",
      };

      const result = normalizeAddress(input);
      expect(result!.street1).toContain("123");
      expect(result!.street1).toContain("Main");
      expect(result!.street2).toBe("Apt 5B");
    });

    it("should handle state names instead of codes", () => {
      const input = {
        street1: "123 Main St",
        city: "Austin",
        stateOrCountry: "TX", // This should map to US
        zipCode: "78701",
      };

      const result = normalizeAddress(input);
      expect(result!.country_code).toBe("US");
      expect(result!.state_or_country).toBe("TX");
    });

    it("should handle addresses with PO Boxes", () => {
      const input = {
        street1: "PO Box 171305",
        city: "Salt Lake City",
        stateOrCountry: "UT",
        stateOrCountryDescription: "UTAH",
        zipCode: "84117",
      };

      const result = normalizeAddress(input);
      expect(result!.street1).toBe("PO Box 171305");
    });
  });

  describe("Canadian Addresses", () => {
    it("should clean a basic Canadian address", () => {
      const input = {
        street1: "123 Rue Principale",
        city: "Montreal",
        stateOrCountry: "A8", // Quebec
        zipCode: "H1A 1A1",
      };

      const result = normalizeAddress(input);

      expect(result).toBeDefined();
      expect(result!.country_code).toBe("CA");
      expect(result!.state_or_country).toBe("A8");
      expect(result!.zip).toBe("H1A 1A1");
    });

    it("should normalize Canadian postal codes", () => {
      const input = {
        street1: "123 Main St",
        city: "Toronto",
        stateOrCountry: "A6", // Ontario
        zipCode: "M5V3A8",
      };

      const result = normalizeAddress(input);
      expect(result!.zip).toBe("M5V 3A8");
    });

    it("should detect Canadian cities", () => {
      const input = {
        street1: "123 Main St",
        city: "Toronto",
        stateOrCountry: "",
        zipCode: "M5V 3A8",
      };

      const result = normalizeAddress(input);
      expect(result!.state_or_country).toBe("A0"); // Should be detected from keyword
    });
  });

  describe("UK Addresses", () => {
    it("should clean a basic UK address", () => {
      const input = {
        street1: "123 High Street",
        city: "London",
        stateOrCountry: "X0",
        zipCode: "SW1A 1AA",
      };

      const result = normalizeAddress(input);

      expect(result).toBeDefined();
      expect(result!.country_code).toBe("GB");
      expect(result!.zip).toBe("SW1A 1AA");
    });

    it("should normalize UK postal codes", () => {
      const input = {
        street1: "123 Main St",
        city: "Manchester",
        stateOrCountry: "X0",
        zipCode: "M11AA",
      };

      const result = normalizeAddress(input);
      expect(result!.zip).toBe("M1 1AA");
    });

    it("should detect UK cities", () => {
      const input = {
        street1: "123 Main St",
        city: "London",
        stateOrCountry: "",
        zipCode: "SW1A 1AA",
      };

      const result = normalizeAddress(input);
      expect(result!.state_or_country).toBe("X0");
    });
  });

  describe("Street Address Cleaning", () => {
    it("should remove care-of patterns", () => {
      const input = {
        street1: "123 Main St C/O John Doe",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result = normalizeAddress(input);
      expect(result!.street1).toBe("123 Main St");
    });

    it("should remove company endings", () => {
      const input = {
        street1: "ACME Corp Inc",
        street2: "One Acme Way",
        city: "New York City",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result = normalizeAddress(input);
      expect(result?.street1).toBe("1 Acme Way");
    });

    it("should consolidate street addresses", () => {
      const input = {
        street1: "",
        street2: "123 Main St",
        street3: "Apt 5B",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result = normalizeAddress(input);
      expect(result!.street1).toBe("123 Main St");
      expect(result!.street2).toBe("Apt 5B");
      expect(result!.street3).toBeNull();
    });

    it("should handle multiple empty street fields", () => {
      const input = {
        street1: null,
        street2: "",
        street3: "123 Main St",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result = normalizeAddress(input);
      expect(result!.street1).toBe("123 Main St");
      expect(result!.street2).toBeNull();
      expect(result!.street3).toBeNull();
    });
  });

  describe("City Normalization", () => {
    it("should normalize Saint to ST", () => {
      const input = {
        street1: "123 Main St",
        city: "Saint Paul",
        stateOrCountry: "MN",
        zipCode: "55101",
      };

      const result = normalizeAddress(input);
      expect(result!.city).toBe("ST PAUL");
    });

    it("should normalize Mount to MT", () => {
      const input = {
        street1: "123 Main St",
        city: "Mount Vernon",
        stateOrCountry: "NY",
        zipCode: "10550",
      };

      const result = normalizeAddress(input);
      expect(result!.city).toBe("MT VERNON");
    });

    it("should normalize NYC to New York", () => {
      const input = {
        street1: "123 Main St",
        city: "NYC",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result = normalizeAddress(input);
      expect(result!.city).toBe("NEW YORK");
    });
  });

  describe("Country Detection", () => {
    it("should detect country from city keywords", () => {
      const input = {
        street1: "123 Main St",
        city: "Shanghai",
        stateOrCountry: "",
        zipCode: "200000",
      };

      const result = normalizeAddress(input);
      expect(result!.state_or_country).toBe("F4");
      expect(result!.country_code).toBe("CN");
    });

    it("should use provided country code", () => {
      const input = {
        street1: "123 Main St",
        city: "Paris",
        stateOrCountry: "I0",
        countryCode: "FR",
      };

      const result = normalizeAddress(input);
      expect(result!.country_code).toBe("FR");
    });

    it("should find country by name", () => {
      const input = {
        street1: "123 Main St",
        city: "Sydney",
        stateOrCountry: "C3",
        country: "Australia",
      };

      const result = normalizeAddress(input);
      expect(result!.country_code).toBe("AU");
    });
  });

  describe("Hash Generation", () => {
    it("should generate consistent hashes for identical addresses", () => {
      const input = {
        street1: "123 Main St",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result1 = normalizeAddress(input);
      const result2 = normalizeAddress(input);

      expect(result1!.address_hash_id).toBe(result2!.address_hash_id);
    });

    it("should generate different hashes for different addresses", () => {
      const input1 = {
        street1: "123 Main St",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const input2 = {
        street1: "456 Oak Ave",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result1 = normalizeAddress(input1);
      const result2 = normalizeAddress(input2);

      expect(result1!.address_hash_id).not.toBe(result2!.address_hash_id);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should return undefined for null input", () => {
      const result = normalizeAddress(null);
      expect(result).toBeUndefined();
    });

    it("should return undefined when required fields are missing", () => {
      const input = {
        street1: "123 Main St",
        city: "",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result = normalizeAddress(input);
      expect(result).toBeUndefined();
    });

    it("should return undefined when no street address is provided", () => {
      const input = {
        street1: null,
        street2: null,
        street3: null,
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "10001",
      };

      const result = normalizeAddress(input);
      expect(result).toBeUndefined();
    });

    it("should return undefined when state/country cannot be determined", () => {
      const input = {
        street1: "123 Main St",
        city: "Unknown City",
        stateOrCountry: "",
        zipCode: "12345",
      };

      const result = normalizeAddress(input);
      expect(result).toBeUndefined();
    });

    it("should handle whitespace-only fields", () => {
      const input = {
        street1: "   123 Main St   ",
        city: "  New York  ",
        stateOrCountry: "  NY  ",
        zipCode: "  10001  ",
      };

      const result = normalizeAddress(input);
      expect(result!.street1).toBe("123 Main St");
      expect(result!.city).toBe("NEW YORK");
      expect(result!.state_or_country).toBe("NY");
      expect(result!.zip).toBe("10001");
    });

    it("should handle invalid postal codes gracefully", () => {
      const input = {
        street1: "123 Main St",
        city: "New York",
        stateOrCountry: "NY",
        zipCode: "invalid",
      };

      const result = normalizeAddress(input);
      expect(result!.zip).toBe("INVALID");
    });
  });

  describe("International Addresses", () => {
    it("should handle German addresses", () => {
      const input = {
        street1: "Hauptstraße 123",
        city: "Munich",
        stateOrCountry: "2M",
        zipCode: "80331",
      };

      const result = normalizeAddress(input);
      expect(result!.country_code).toBe("DE");
      expect(result!.zip).toBe("80331");
    });

    it("should handle Singapore addresses", () => {
      const input = {
        street1: "123 Orchard Road",
        city: "Singapore",
        stateOrCountry: "U0",
        zipCode: "238869",
      };

      const result = normalizeAddress(input);
      expect(result!.country_code).toBe("SG");
      expect(result!.state_or_country).toBe("U0");
    });

    it("should detect Hong Kong from city name", () => {
      const input = {
        street1: "123 Nathan Road",
        city: "Hong Kong",
        stateOrCountry: "",
        zipCode: "",
      };

      const result = normalizeAddress(input);
      expect(result!.state_or_country).toBe("K3");
      expect(result!.country_code).toBe("HK");
    });
  });

  describe("Complex Address Scenarios", () => {
    it("should handle addresses with foreign territory info", () => {
      const input = {
        street1: "123 Main St",
        city: "San Juan",
        stateOrCountry: "PR",
        zipCode: "00901",
        isForeignLocation: false,
        foreignStateTerritory: null,
      };

      const result = normalizeAddress(input);
      expect(result!.country_code).toBe("US");
      expect(result!.state_or_country).toBe("PR");
    });

    it("should handle mixed case and special characters in street names", () => {
      const input = {
        street1: "123 St. François Xavier Ave.",
        city: "Montréal",
        stateOrCountry: "A8",
        zipCode: "H2Y 2Y5",
      };

      const result = normalizeAddress(input);
      expect(result).toBeDefined();
      expect(result!.country_code).toBe("CA");
    });

    it("should consolidate and clean multiple street lines with care-of", () => {
      const input = {
        street1: "C/O Legal Department",
        street2: "456 Corporate Blvd",
        street3: "Suite 100",
        city: "Boston",
        stateOrCountry: "MA",
        zipCode: "02101",
      };

      const result = normalizeAddress(input);
      expect(result!.street1).toBe("456 Corporate Blvd");
      expect(result!.street2).toBe("Suite 100");
      expect(result!.street3).toBeNull();
    });
  });
});
