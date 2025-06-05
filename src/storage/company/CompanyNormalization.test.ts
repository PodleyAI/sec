//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { normalizeCompany, CompanyImport } from "./CompanyNormalization";

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
  });
});
