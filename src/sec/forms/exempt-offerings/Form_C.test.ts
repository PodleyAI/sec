//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_C } from "./Form_C";
import type { FormC } from "./Form_C.schema";

describe("Form_C parsing test", () => {
  describe("Form C parsing with all mock data", () => {
    it("should parse all Form C files from mock_data/form-c directory", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      expect(xmlFiles.length).toBeGreaterThan(0);
      console.log(`Found ${xmlFiles.length} Form C XML files to test`);

      const results: Array<{
        file: string;
        accessionNumber?: string;
        cik?: string;
        issuerName?: string;
        submissionType?: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");

        try {
          // Parse the Form C
          const formC = await Form_C.parse("C", xmlContent);

          // Extract metadata
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const cik = formC.headerData.filerInfo.filer.filerCredentials.filerCik;
          const issuerName = formC.formData.issuerInformation.issuerInfo.nameOfIssuer;
          const submissionType = formC.headerData.submissionType;

          // Validate the parsed data structure
          expect(formC).toBeDefined();
          expect(formC.headerData).toBeDefined();
          expect(formC.formData).toBeDefined();
          expect(formC.headerData.submissionType).toMatch(/^C/);
          expect(cik).toMatch(/^\d{10}$/);
          expect(issuerName).toBeTruthy();

          // Validate specific structure elements
          expect(formC.headerData.filerInfo).toBeDefined();
          expect(formC.headerData.filerInfo.liveTestFlag).toMatch(/^(LIVE|TEST)$/);
          expect(formC.formData.issuerInformation).toBeDefined();
          expect(formC.formData.signatureInfo).toBeDefined();

          results.push({
            file,
            accessionNumber,
            cik,
            issuerName,
            submissionType,
            success: true,
          });

          console.log(`✓ Successfully parsed ${file}: ${issuerName} (CIK: ${cik})`);
        } catch (error) {
          console.error(`✗ Error processing ${file}:`, error);
          results.push({
            file,
            error: error instanceof Error ? error.message : String(error),
            success: false,
          });
        }
      }

      // Print summary
      const successfulFiles = results.filter((r) => r.success);
      const failedFiles = results.filter((r) => !r.success);

      console.log(`\nParsing Summary:`);
      console.log(`✓ Successful: ${successfulFiles.length}`);
      console.log(`✗ Failed: ${failedFiles.length}`);

      if (failedFiles.length > 0) {
        console.error("\nFailed files:");
        failedFiles.forEach((f) => console.error(`  - ${f.file}: ${f.error}`));
      }

      // Assert all files were processed successfully
      expect(failedFiles.length).toBe(0);
      expect(successfulFiles.length).toBe(xmlFiles.length);
    });

    it("should validate specific Form C data structures", async () => {
      const testFile = "000167025422000972-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const formC = await Form_C.parse("C", xmlContent);

      // Test header data
      expect(formC.headerData.submissionType).toBe("C");
      expect(formC.headerData.filerInfo.filer.filerCredentials.filerCik).toBe("0001944416");
      expect(formC.headerData.filerInfo.liveTestFlag).toBe("LIVE");

      // Test issuer information
      expect(formC.formData.issuerInformation.issuerInfo.nameOfIssuer).toBe("Apsy Inc");
      expect(formC.formData.issuerInformation.issuerInfo.legalStatus?.legalStatusForm).toBe(
        "Corporation"
      );
      expect(
        formC.formData.issuerInformation.issuerInfo.legalStatus?.jurisdictionOrganization
      ).toBe("DE");

      // Test offering information
      expect(formC.formData.offeringInformation?.securityOfferedType).toBe("Other");
      expect(formC.formData.offeringInformation?.securityOfferedOtherDesc).toBe(
        "Simple Agreement for Future Equity (SAFE)"
      );
      expect(formC.formData.offeringInformation?.offeringAmount).toBe(50000.0);
      expect(formC.formData.offeringInformation?.maximumOfferingAmount).toBe(1000000.0);

      // Test co-issuers
      expect(formC.formData.issuerInformation.isCoIssuer).toBe("Y");
      expect(formC.formData.issuerInformation.coIssuers?.coIssuerInfo).toBeDefined();
      expect(formC.formData.issuerInformation.coIssuers?.coIssuerInfo?.length).toBe(2);

      // Test annual report disclosure requirements
      expect(formC.formData.annualReportDisclosureRequirements?.currentEmployees).toBe(4);
      expect(
        formC.formData.annualReportDisclosureRequirements?.totalAssetMostRecentFiscalYear
      ).toBe(36580.0);
      expect(formC.formData.annualReportDisclosureRequirements?.revenueMostRecentFiscalYear).toBe(
        101736.0
      );

      // Test signature information
      expect(formC.formData.signatureInfo.issuerSignature.issuer).toBe("Apsy Inc");
      expect(formC.formData.signatureInfo.issuerSignature.issuerSignature).toBe("Tooraj Helmi");
      expect(formC.formData.signatureInfo.issuerSignature.issuerTitle).toBe("CEO");
      expect(formC.formData.signatureInfo.signaturePersons.signaturePerson.length).toBe(1);
    });

    it("should handle different submission types correctly", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      const submissionTypes = new Set<string>();

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const formC = await Form_C.parse("C", xmlContent);
        submissionTypes.add(formC.headerData.submissionType);
      }

      console.log("Found submission types:", Array.from(submissionTypes));

      // Validate submission types are valid Form C types
      const validTypes = [
        "C",
        "C-W",
        "C-U",
        "C-U-W",
        "C/A",
        "C/A-W",
        "C-AR",
        "C-AR-W",
        "C-AR/A",
        "C-AR/A-W",
        "C-TR",
        "C-TR-W",
      ];

      submissionTypes.forEach((type) => {
        expect(validTypes).toContain(type);
      });
    });

    it("should validate jurisdiction codes in annual report disclosure", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const formC = await Form_C.parse("C", xmlContent);

        if (
          formC.formData.annualReportDisclosureRequirements?.issueJurisdictionSecuritiesOffering
        ) {
          const jurisdictions =
            formC.formData.annualReportDisclosureRequirements.issueJurisdictionSecuritiesOffering;

          jurisdictions.forEach((jurisdiction) => {
            // Should be valid state/territory codes
            expect(jurisdiction).toMatch(/^[A-Z0-9]{2}$/);
          });
        }
      }
    });

    it("should validate CIK format across all files", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const formC = await Form_C.parse("C", xmlContent);

        const cik = formC.headerData.filerInfo.filer.filerCredentials.filerCik;

        // CIK should be 10 digits
        expect(cik).toMatch(/^\d{10}$/);

        // Commission CIK (if present) should also be valid
        if (formC.formData.issuerInformation.commissionCik) {
          expect(formC.formData.issuerInformation.commissionCik).toMatch(/^\d{10}$/);
        }
      }
    });
  });

  describe("Form C edge cases and validation", () => {
    it("should handle forms with minimal data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const formC = await Form_C.parse("C", xmlContent);

        // Essential fields that should always be present
        expect(formC.headerData.submissionType).toBeTruthy();
        expect(formC.headerData.filerInfo.filer.filerCredentials.filerCik).toBeTruthy();
        expect(formC.formData.issuerInformation.issuerInfo.nameOfIssuer).toBeTruthy();
        expect(formC.formData.signatureInfo.issuerSignature.issuer).toBeTruthy();
      }
    });

    it("should validate date formats", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const formC = await Form_C.parse("C", xmlContent);

        // Check date formats where present
        if (formC.formData.issuerInformation.issuerInfo.legalStatus?.dateIncorporation) {
          const dateStr = formC.formData.issuerInformation.issuerInfo.legalStatus.dateIncorporation;
          // Should be a valid date string (MM-DD-YYYY format in this case)
          expect(dateStr).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        }

        if (formC.formData.offeringInformation?.deadlineDate) {
          const deadlineStr = formC.formData.offeringInformation.deadlineDate;
          expect(deadlineStr).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        }

        // Signature dates
        formC.formData.signatureInfo.signaturePersons.signaturePerson.forEach((person) => {
          expect(person.signatureDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        });
      }
    });
  });
});
