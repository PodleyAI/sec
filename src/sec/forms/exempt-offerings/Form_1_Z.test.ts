//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_1_Z } from "./Form_1_Z";

describe("Form_1_Z parsing test", () => {
  describe("Form 1-Z parsing with all mock data", () => {
    it("should parse all Form 1-Z files from mock_data/form-1-z directory", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      expect(xmlFiles.length).toBeGreaterThan(0);
      console.log(`Found ${xmlFiles.length} Form 1-Z XML files to test`);

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
          // Parse the Form 1-Z
          const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

          // Extract metadata
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const cik = form1Z.headerData.filerInfo.filer.issuerCredentials.cik;
          const issuerName = form1Z.formData.item1.issuerName;
          const submissionType = form1Z.headerData.submissionType;

          // Validate the parsed data structure
          expect(form1Z).toBeDefined();
          expect(form1Z.headerData).toBeDefined();
          expect(form1Z.formData).toBeDefined();
          expect(form1Z.headerData.submissionType).toMatch(/^1-Z/);
          expect(cik).toMatch(/^\d{10}$/);
          expect(issuerName).toBeTruthy();

          // Validate specific structure elements
          expect(form1Z.headerData.filerInfo).toBeDefined();
          expect(form1Z.headerData.filerInfo.liveTestFlag).toMatch(/^(LIVE|TEST)$/);
          expect(form1Z.formData.item1).toBeDefined();
          expect(form1Z.formData.signatureTab).toBeDefined();

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

    it("should validate specific Form 1-Z data structures", async () => {
      const testFile = "000110465922083200-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

      // Test header data
      expect(form1Z.headerData.submissionType).toBe("1-Z");
      expect(form1Z.headerData.filerInfo.filer.issuerCredentials.cik).toBe("0001908252");
      expect(form1Z.headerData.filerInfo.liveTestFlag).toBe("LIVE");
      expect(form1Z.headerData.filerInfo.flags.successorFilingFlag).toBe("N");

      // Test item1 information
      expect(form1Z.formData.item1.issuerName).toBe("StartEngine Collectibles Fund II LLC");
      expect(form1Z.formData.item1.street1).toBe("3900 W. Alameda Ave.");
      expect(form1Z.formData.item1.street2).toBe("Suite 1200");
      expect(form1Z.formData.item1.city).toBe("BURBANK");
      expect(form1Z.formData.item1.stateOrCountry).toBe("CA");
      expect(form1Z.formData.item1.zipCode).toBe("91505");
      expect(form1Z.formData.item1.phone).toBe("949-415-8730");
      expect(form1Z.formData.item1.commissionFileNumber).toContain("024-11793");

      // Test summary info offering
      expect(form1Z.formData.summaryInfoOffering).toBeDefined();
      if (form1Z.formData.summaryInfoOffering && form1Z.formData.summaryInfoOffering.length > 0) {
        const offering = form1Z.formData.summaryInfoOffering[0];
        expect(offering.offeringQualificationDate).toBe("02-24-2022");
        expect(offering.offeringCommenceDate).toBe("02-24-2022");
        expect(offering.offeringSecuritiesQualifiedSold).toBe(6416);
        expect(offering.offeringSecuritiesSold).toBe(0);
        expect(offering.pricePerSecurity).toBe(10.0);
        expect(offering.portionSecuritiesSoldIssuer).toBe(0.0);
        expect(offering.portionSecuritiesSoldSecurityholders).toBe(0.0);
        expect(offering.auditorSpName).toContain("BF Borgers");
        expect(offering.auditorFees).toBe(5000.0);
        expect(offering.legalSpName).toContain("CrowdCheck");
        expect(offering.legalFees).toBe(25000.0);
        expect(offering.issuerNetProceeds).toBe(0.0);
      }

      // Test certification suspension
      expect(form1Z.formData.certificationSuspension).toBeDefined();
      if (
        form1Z.formData.certificationSuspension &&
        form1Z.formData.certificationSuspension.length > 0
      ) {
        const cert = form1Z.formData.certificationSuspension[0];
        expect(cert.securitiesClassTitle).toBe("None");
        expect(cert.certificationFileNumber).toContain("024-11793");
        expect(cert.approxRecordHolders).toBe(0);
      }

      // Test signature tab
      expect(form1Z.formData.signatureTab).toBeDefined();
      expect(form1Z.formData.signatureTab.length).toBeGreaterThan(0);
      const signature = form1Z.formData.signatureTab[0];
      expect(signature.cik).toBe("0001908252");
      expect(signature.regulationIssuerName1).toBe("StartEngine Collectibles Fund II LLC");
      expect(signature.regulationIssuerName2).toBe("StartEngine Collectibles Fund II LLC");
      expect(signature.signatureBy).toBe("/s/ Johanna Cronin");
      expect(signature.date).toBe("07-27-2022");
      expect(signature.title).toBe("Manager of StartEngine Assets LLC, its Manager");
    });

    it("should handle different submission types correctly", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      const submissionTypes = new Set<string>();

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);
        submissionTypes.add(form1Z.headerData.submissionType);
      }

      console.log("Found submission types:", Array.from(submissionTypes));

      // Validate submission types are valid Form 1-Z types
      const validTypes = ["1-Z", "1-Z/A"];

      submissionTypes.forEach((type) => {
        expect(validTypes).toContain(type);
      });
    });

    it("should validate successor filing flags", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

        // Test successor filing flag
        expect(["Y", "N"]).toContain(form1Z.headerData.filerInfo.flags.successorFilingFlag);
      }
    });

    it("should validate jurisdiction codes", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

        // Test state or country in item1
        if (form1Z.formData.item1.stateOrCountry) {
          expect(form1Z.formData.item1.stateOrCountry).toMatch(/^[A-Z0-9]{2}$/);
        }
      }
    });

    it("should validate financial data types and ranges", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

        // Test summary info offering financial data
        if (form1Z.formData.summaryInfoOffering) {
          form1Z.formData.summaryInfoOffering.forEach((offering) => {
            // Test financial amounts are numbers
            const financialFields = [
              offering.pricePerSecurity,
              offering.portionSecuritiesSoldIssuer,
              offering.portionSecuritiesSoldSecurityholders,
              offering.underwriterFees,
              offering.salesCommissionsFee,
              offering.findersFees,
              offering.auditorFees,
              offering.legalFees,
              offering.promotersFees,
              offering.blueSkyFees,
              offering.issuerNetProceeds,
            ];

            financialFields.forEach((value) => {
              if (value !== undefined && value !== null) {
                expect(typeof value).toBe("number");
              }
            });

            // Test security counts are non-negative integers
            if (offering.offeringSecuritiesQualifiedSold !== undefined) {
              expect(offering.offeringSecuritiesQualifiedSold).toBeGreaterThanOrEqual(0);
              expect(Number.isInteger(offering.offeringSecuritiesQualifiedSold)).toBe(true);
            }

            if (offering.offeringSecuritiesSold !== undefined) {
              expect(offering.offeringSecuritiesSold).toBeGreaterThanOrEqual(0);
              expect(Number.isInteger(offering.offeringSecuritiesSold)).toBe(true);
            }
          });
        }

        // Test certification suspension data
        if (form1Z.formData.certificationSuspension) {
          form1Z.formData.certificationSuspension.forEach((cert) => {
            if (cert.approxRecordHolders !== undefined) {
              expect(cert.approxRecordHolders).toBeGreaterThanOrEqual(0);
              expect(Number.isInteger(cert.approxRecordHolders)).toBe(true);
            }
          });
        }
      }
    });

    it("should validate date formats", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

        // Test summary info offering dates
        if (form1Z.formData.summaryInfoOffering) {
          form1Z.formData.summaryInfoOffering.forEach((offering) => {
            if (offering.offeringQualificationDate) {
              // Dates should be in MM-DD-YYYY format or similar
              expect(offering.offeringQualificationDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
            }

            if (offering.offeringCommenceDate) {
              expect(offering.offeringCommenceDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
            }
          });
        }

        // Test signature dates
        if (form1Z.formData.signatureTab) {
          form1Z.formData.signatureTab.forEach((signature) => {
            if (signature.date) {
              expect(signature.date).toMatch(/^\d{2}-\d{2}-\d{4}$/);
            }
          });
        }
      }
    });

    it("should validate commission file numbers", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

        // Test item1 commission file numbers
        expect(form1Z.formData.item1.commissionFileNumber).toBeDefined();
        expect(Array.isArray(form1Z.formData.item1.commissionFileNumber)).toBe(true);
        expect(form1Z.formData.item1.commissionFileNumber.length).toBeGreaterThan(0);

        form1Z.formData.item1.commissionFileNumber.forEach((fileNumber) => {
          expect(fileNumber).toMatch(/^\d{3}-\d{5}$/);
        });

        // Test certification suspension file numbers
        if (form1Z.formData.certificationSuspension) {
          form1Z.formData.certificationSuspension.forEach((cert) => {
            expect(cert.certificationFileNumber).toBeDefined();
            expect(Array.isArray(cert.certificationFileNumber)).toBe(true);
            expect(cert.certificationFileNumber.length).toBeGreaterThan(0);

            cert.certificationFileNumber.forEach((fileNumber) => {
              expect(fileNumber).toMatch(/^\d{3}-\d{5}$/);
            });
          });
        }
      }
    });

    it("should validate signature information", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

        // Test signature tab
        expect(form1Z.formData.signatureTab).toBeDefined();
        expect(Array.isArray(form1Z.formData.signatureTab)).toBe(true);
        expect(form1Z.formData.signatureTab.length).toBeGreaterThan(0);

        form1Z.formData.signatureTab.forEach((signature) => {
          expect(signature.cik).toMatch(/^\d{10}$/);
          expect(signature.regulationIssuerName1).toBeTruthy();
          expect(signature.regulationIssuerName2).toBeTruthy();
          expect(signature.signatureBy).toBeTruthy();
          expect(signature.date).toBeTruthy();
          expect(signature.title).toBeTruthy();
        });
      }
    });
  });
});
