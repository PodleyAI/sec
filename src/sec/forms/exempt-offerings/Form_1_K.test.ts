//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_1_K } from "./Form_1_K";
import type { Form1K } from "./Form_1_K.schema";

describe("Form_1_K parsing test", () => {
  describe("Form 1-K parsing with all mock data", () => {
    it("should parse all Form 1-K files from mock_data/form-1-k directory", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      expect(xmlFiles.length).toBeGreaterThan(0);
      console.log(`Found ${xmlFiles.length} Form 1-K XML files to test`);

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
          // Parse the Form 1-K
          const form1K = await Form_1_K.parse("1-K", xmlContent);

          // Extract metadata
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const cik = form1K.headerData.filerInfo.filer.issuerCredentials.cik;
          const issuerName = form1K.formData.item1Info[0]?.issuerName || "N/A";
          const submissionType = form1K.headerData.submissionType;

          // Validate the parsed data structure
          expect(form1K).toBeDefined();
          expect(form1K.headerData).toBeDefined();
          expect(form1K.formData).toBeDefined();
          expect(form1K.headerData.submissionType).toMatch(/^1-K/);
          expect(cik).toMatch(/^\d{10}$/);

          // Validate specific structure elements
          expect(form1K.headerData.filerInfo).toBeDefined();
          expect(form1K.headerData.filerInfo.liveTestFlag).toMatch(/^(LIVE|TEST)$/);
          expect(form1K.formData.item1).toBeDefined();
          expect(form1K.formData.item1Info).toBeDefined();
          expect(form1K.formData.item2).toBeDefined();

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

    it("should validate specific Form 1-K data structures", async () => {
      const testFile = "000149315222011080-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const form1K = await Form_1_K.parse("1-K", xmlContent);

      // Test header data
      expect(form1K.headerData.submissionType).toBe("1-K");
      expect(form1K.headerData.filerInfo.filer.issuerCredentials.cik).toBe("0001882020");
      expect(form1K.headerData.filerInfo.liveTestFlag).toBe("LIVE");
      expect(form1K.headerData.filerInfo.flags.shellCompanyFlag).toBe("N");
      expect(form1K.headerData.filerInfo.flags.successorFilingFlag).toBe("N");
      expect(form1K.headerData.filerInfo.flags.returnCopyFlag).toBe("true");
      expect(form1K.headerData.filerInfo.reportingPeriod).toBe("12-31-2021");

      // Test item1 information
      expect(form1K.formData.item1.formIndication).toBe("Annual Report");
      expect(form1K.formData.item1.fiscalYearEnd).toBe("12-31-2021");
      expect(form1K.formData.item1.street1).toBe("225 LIBERTY STREET, 29TH FLOOR");
      expect(form1K.formData.item1.city).toBe("NEW YORK");
      expect(form1K.formData.item1.stateOrCountry).toBe("NY");
      expect(form1K.formData.item1.zipCode).toBe("10281");
      expect(form1K.formData.item1.phoneNumber).toBe("203-518-5172");
      expect(form1K.formData.item1.issuedSecuritiesTitle).toBe("Class A ordinary shares");

      // Test item1Info information
      expect(form1K.formData.item1Info).toBeDefined();
      expect(Array.isArray(form1K.formData.item1Info)).toBe(true);
      expect(form1K.formData.item1Info.length).toBeGreaterThan(0);
      const item1Info = form1K.formData.item1Info[0];
      expect(item1Info.issuerName).toBe("Masterworks 078, LLC");
      expect(item1Info.cik).toBe("0001882020");
      expect(item1Info.jurisdictionOrganization).toBe("DE");
      expect(item1Info.irsNum).toBe("87-2465121");

      // Test item2 information
      expect(form1K.formData.item2.regArule257).toBe("false");

      // Test summary info
      expect(form1K.formData.summaryInfo).toBeDefined();
      if (form1K.formData.summaryInfo && form1K.formData.summaryInfo.length > 0) {
        const summary = form1K.formData.summaryInfo[0];
        expect(summary.commissionFileNumber).toBe("024-11638");
        expect(summary.offeringQualificationDate).toBe("10-20-2021");
        expect(summary.offeringCommenceDate).toBe("10-22-2021");
        expect(summary.qualifiedSecuritiesSold).toBe(166500);
        expect(summary.offeringSecuritiesSold).toBe(166500);
        expect(summary.pricePerSecurity).toBe(20.0);
        expect(summary.aggregrateOfferingPrice).toBe(3330000.0);
        expect(summary.aggregrateOfferingPriceHolders).toBe(0.0);
        expect(summary.underwrittenSpName).toBe(
          "Independent Brokerage Solutions LLC and Arete Wealth Management, LLC"
        );
        expect(summary.underwriterFees).toBe(39767.0);
        expect(summary.salesCommissionsSpName).toBe(
          "Independent Brokerage Solutions LLC and Arete Wealth Management, LLC"
        );
        expect(summary.salesCommissionsFee).toBe(99900.0);
        expect(summary.findersSpName).toBe("N/A");
        expect(summary.findersFees).toBe(0.0);
        expect(summary.auditorSpName).toBe("LGA, LLP");
        expect(summary.auditorFees).toBe(5500.0);
        expect(summary.legalSpName).toBe("Anthony L.G., PLLC");
        expect(summary.legalFees).toBe(5000.0);
        expect(summary.promoterSpName).toBe("N/A");
        expect(summary.promotersFees).toBe(0.0);
        expect(summary.blueSkySpName).toBe("Anthony L.G., PLLC");
        expect(summary.blueSkyFees).toBe(5000.0);
        expect(summary.crdNumberBrokerDealer).toBe("153563");
        expect(summary.issuerNetProceeds).toBe(3330000.0);
        expect(summary.clarificationResponses).toContain("Estimated Net Proceeds Calculation");
      }
    });

    it("should handle different submission types correctly", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      const submissionTypes = new Set<string>();

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);
        submissionTypes.add(form1K.headerData.submissionType);
      }

      // console.log("Found submission types:", Array.from(submissionTypes));

      // Validate submission types are valid Form 1-K types
      const validTypes = ["1-K", "1-K/A"];

      submissionTypes.forEach((type) => {
        expect(validTypes).toContain(type);
      });
    });

    it("should validate form indications", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      const formIndications = new Set<string>();

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);
        formIndications.add(form1K.formData.item1.formIndication);
      }

      // Validate form indications are valid types
      const validIndications = ["Annual Report", "Special Financial Report for the fiscal year"];

      formIndications.forEach((indication) => {
        expect(validIndications).toContain(indication);
      });
    });

    it("should validate Y/N flags", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        // Test shell company flag
        expect(["Y", "N"]).toContain(form1K.headerData.filerInfo.flags.shellCompanyFlag);

        // Test successor filing flag
        expect(["Y", "N"]).toContain(form1K.headerData.filerInfo.flags.successorFilingFlag);
      }
    });

    it("should validate true/false flags", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        // Test regArule257 flag
        expect(["true", "false"]).toContain(form1K.formData.item2.regArule257);

        // Test optional true/false flags
        if (form1K.headerData.filerInfo.flags.returnCopyFlag !== undefined) {
          expect(["true", "false"]).toContain(form1K.headerData.filerInfo.flags.returnCopyFlag);
        }
      }
    });

    it("should validate jurisdiction codes", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        // Test state or country in item1
        if (form1K.formData.item1.stateOrCountry) {
          expect(form1K.formData.item1.stateOrCountry).toMatch(/^[A-Z0-9]{2}$/);
        }

        // Test jurisdiction of organization in item1Info
        form1K.formData.item1Info.forEach((info) => {
          if (info.jurisdictionOrganization) {
            expect(info.jurisdictionOrganization).toMatch(/^[A-Z]{2}$/);
          }
        });
      }
    });

    it("should validate financial data types and ranges", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        // Test summary info financial data
        if (form1K.formData.summaryInfo) {
          form1K.formData.summaryInfo.forEach((summary) => {
            // Test financial amounts are numbers
            const financialFields = [
              summary.pricePerSecurity,
              summary.aggregrateOfferingPrice,
              summary.aggregrateOfferingPriceHolders,
              summary.underwriterFees,
              summary.salesCommissionsFee,
              summary.findersFees,
              summary.auditorFees,
              summary.legalFees,
              summary.promotersFees,
              summary.blueSkyFees,
              summary.issuerNetProceeds,
            ];

            financialFields.forEach((value) => {
              if (value !== undefined && value !== null) {
                expect(typeof value).toBe("number");
              }
            });

            // Test security counts are non-negative integers
            if (summary.qualifiedSecuritiesSold !== undefined) {
              expect(summary.qualifiedSecuritiesSold).toBeGreaterThanOrEqual(0);
              expect(Number.isInteger(summary.qualifiedSecuritiesSold)).toBe(true);
            }

            if (summary.offeringSecuritiesSold !== undefined) {
              expect(summary.offeringSecuritiesSold).toBeGreaterThanOrEqual(0);
              expect(Number.isInteger(summary.offeringSecuritiesSold)).toBe(true);
            }
          });
        }
      }
    });

    it("should validate date formats", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        // Test reporting period date
        if (form1K.headerData.filerInfo.reportingPeriod) {
          expect(form1K.headerData.filerInfo.reportingPeriod).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        }

        // Test fiscal year end date
        if (form1K.formData.item1.fiscalYearEnd) {
          expect(form1K.formData.item1.fiscalYearEnd).toMatch(/^\d{2}-\d{2}-\d{4}$/);
        }

        // Test summary info dates
        if (form1K.formData.summaryInfo) {
          form1K.formData.summaryInfo.forEach((summary) => {
            if (summary.offeringQualificationDate) {
              expect(summary.offeringQualificationDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
            }

            if (summary.offeringCommenceDate) {
              expect(summary.offeringCommenceDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
            }
          });
        }
      }
    });

    it("should validate commission file numbers", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        // Test summary info commission file numbers
        if (form1K.formData.summaryInfo) {
          form1K.formData.summaryInfo.forEach((summary) => {
            if (summary.commissionFileNumber) {
              expect(summary.commissionFileNumber).toMatch(/^\d{3}-\d{5}$/);
            }
          });
        }
      }
    });

    it("should validate IRS numbers", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        // Test item1Info IRS numbers
        form1K.formData.item1Info.forEach((info) => {
          if (info.irsNum) {
            expect(info.irsNum).toMatch(/^\d{2}-\d{7}$/);
          }
        });
      }
    });

    it("should validate CRD numbers", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        // Test summary info CRD numbers
        if (form1K.formData.summaryInfo) {
          form1K.formData.summaryInfo.forEach((summary) => {
            if (summary.crdNumberBrokerDealer) {
              expect(summary.crdNumberBrokerDealer).toMatch(/^\d+$/);
              expect(summary.crdNumberBrokerDealer.length).toBeLessThanOrEqual(9);
            }
          });
        }
      }
    });
  });
});
