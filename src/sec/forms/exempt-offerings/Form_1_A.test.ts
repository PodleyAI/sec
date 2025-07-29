//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_1_A } from "./Form_1_A";
import type { Form1A } from "./Form_1_A.schema";

describe("Form_1_A parsing test", () => {
  describe("Form 1-A parsing with all mock data", () => {
    it("should parse all Form 1-A files from mock_data/form-1-a directory", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      expect(xmlFiles.length).toBeGreaterThan(0);
      console.log(`Found ${xmlFiles.length} Form 1-A XML files to test`);

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
          // Parse the Form 1-A
          const form1A = await Form_1_A.parse("1-A", xmlContent);

          // Extract metadata
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const cik = form1A.headerData.filerInfo.filer.issuerCredentials.cik;
          const issuerName = form1A.formData.employeesInfo[0].issuerName;
          const submissionType = form1A.headerData.submissionType;

          // Validate the parsed data structure
          expect(form1A).toBeDefined();
          expect(form1A.headerData).toBeDefined();
          expect(form1A.formData).toBeDefined();
          expect(form1A.headerData.submissionType).toMatch(/^1-A/);
          expect(cik).toMatch(/^\d{10}$/);
          expect(issuerName).toBeTruthy();

          // Validate specific structure elements
          expect(form1A.headerData.filerInfo).toBeDefined();
          expect(form1A.headerData.filerInfo.liveTestFlag).toMatch(/^(LIVE|TEST)$/);
          expect(form1A.formData.employeesInfo).toBeDefined();
          expect(form1A.formData.issuerInfo).toBeDefined();
          expect(form1A.formData.summaryInfo).toBeDefined();

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

    it("should validate specific Form 1-A data structures", async () => {
      const testFile = "000109690624000308-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);

      // Test header data
      expect(form1A.headerData.submissionType).toBe("1-A");
      expect(form1A.headerData.filerInfo.filer.issuerCredentials.cik).toBe("0002011021");
      expect(form1A.headerData.filerInfo.liveTestFlag).toBe("LIVE");

      // Test employees information
      expect(form1A.formData.employeesInfo[0].issuerName).toBe("OBSIDIAN PRIME INC");
      expect(form1A.formData.employeesInfo[0].jurisdictionOrganization).toBe("CA");
      expect(form1A.formData.employeesInfo[0].yearIncorporation).toBe(2024);
      expect(form1A.formData.employeesInfo[0].cik).toBe("0002011021");
      expect(form1A.formData.employeesInfo[0].sicCode).toBe(7310);
      expect(form1A.formData.employeesInfo[0].irsNum).toBe("99-1086213");
      expect(form1A.formData.employeesInfo[0].fullTimeEmployees).toBe(0);
      expect(form1A.formData.employeesInfo[0].partTimeEmployees).toBe(0);

      // Test issuer information
      expect(form1A.formData.issuerInfo.street1).toBe("3130 BALFOUR ROAD");
      expect(form1A.formData.issuerInfo.street2).toBe("SUITE D");
      expect(form1A.formData.issuerInfo.city).toBe("BRENTWOOD");
      expect(form1A.formData.issuerInfo.stateOrCountry).toBe("CA");
      expect(form1A.formData.issuerInfo.zipCode).toBe("94513");
      expect(form1A.formData.issuerInfo.phoneNumber).toBe("310-684-3662");
      expect(form1A.formData.issuerInfo.connectionName).toBe("JEFFREY MORTON");
      expect(form1A.formData.issuerInfo.industryGroup).toBe("Other");
      expect(form1A.formData.issuerInfo.nameAuditor).toBe("Amjad Abu Khamis");

      // Test common equity information
      expect(form1A.formData.commonEquity[0].commonEquityClassName).toBe("COMMON STOCK");
      expect(form1A.formData.commonEquity[0].outstandingCommonEquity).toBe(0);
      expect(form1A.formData.commonEquity[0].commonCusipEquity).toBe("N/A");
      expect(form1A.formData.commonEquity[0].publiclyTradedCommonEquity).toBe("N/A");

      // Test issuer eligibility
      expect(form1A.formData.issuerEligibility.certifyIfTrue).toBe("true");

      // Test application rule 262
      expect(form1A.formData.applicationRule262.certifyIfNotDisqualified).toBe("true");
      expect(form1A.formData.applicationRule262.certifyIfBadActor).toBe("false");

      // Test summary information
      expect(form1A.formData.summaryInfo.indicateTier1Tier2Offering).toBe("Tier2");
      expect(form1A.formData.summaryInfo.financialStatementAuditStatus).toBe("Audited");
      expect(form1A.formData.summaryInfo.securitiesOfferedTypes).toBe(
        "Equity (common or preferred stock)"
      );
      expect(form1A.formData.summaryInfo.offerDelayedContinuousFlag).toBe("Y");
      expect(form1A.formData.summaryInfo.offeringYearFlag).toBe("N");
      expect(form1A.formData.summaryInfo.offeringAfterQualifFlag).toBe("N");
      expect(form1A.formData.summaryInfo.offeringBestEffortsFlag).toBe("Y");
      expect(form1A.formData.summaryInfo.solicitationProposedOfferingFlag).toBe("N");
      expect(form1A.formData.summaryInfo.resaleSecuritiesAffiliatesFlag).toBe("N");
      expect(form1A.formData.summaryInfo.securitiesOffered).toBe(75000000);
      expect(form1A.formData.summaryInfo.pricePerSecurity).toBe(1.0);
      expect(form1A.formData.summaryInfo.qualificationOfferingAggregate).toBe(75000000.0);
      expect(form1A.formData.summaryInfo.totalAggregateOffering).toBe(75000000.0);
      expect(form1A.formData.summaryInfo.auditorServiceProviderName).toBe("CF Audits LLC");
      expect(form1A.formData.summaryInfo.auditorFees).toBe(5850.0);
      expect(form1A.formData.summaryInfo.legalServiceProviderName).toBe("Renee Sanders");
      expect(form1A.formData.summaryInfo.legalFees).toBe(30000.0);
      expect(form1A.formData.summaryInfo.estimatedNetAmount).toBe(75000000.0);

      // Test jurisdiction securities offered
      expect(form1A.formData.juridictionSecuritiesOffered?.jurisdictionsOfSecOfferedNone).toBe(
        "false"
      );
      expect(form1A.formData.juridictionSecuritiesOffered?.jurisdictionsOfSecOfferedSame).toBe(
        "true"
      );
      expect(
        form1A.formData.juridictionSecuritiesOffered?.issueJuridicationSecuritiesOffering
      ).toContain("CA");
      expect(
        form1A.formData.juridictionSecuritiesOffered?.dealersJuridicationSecuritiesOffering
      ).toContain("CA");

      // Test unregistered securities
      expect(form1A.formData.unregisteredSecurities?.ifUnregsiteredNone).toBe("true");
    });

    it("should handle different submission types correctly", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      const submissionTypes = new Set<string>();

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1A = await Form_1_A.parse("1-A", xmlContent);
        submissionTypes.add(form1A.headerData.submissionType);
      }

      console.log("Found submission types:", Array.from(submissionTypes));

      // Validate submission types are valid Form 1-A types
      const validTypes = [
        "1-A",
        "1-A/A",
        "1-A POS",
        "1-A-W",
        "253G1",
        "253G2",
        "253G3",
        "253G4",
        "QUALIF",
      ];

      submissionTypes.forEach((type) => {
        expect(validTypes).toContain(type);
      });
    });

    it("should validate tier offerings and financial statement requirements", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1A = await Form_1_A.parse("1-A", xmlContent);

        // Test tier offerings
        if (form1A.formData.summaryInfo.indicateTier1Tier2Offering) {
          expect(["Tier1", "Tier2"]).toContain(
            form1A.formData.summaryInfo.indicateTier1Tier2Offering
          );
        }

        // Test financial statement audit status
        if (form1A.formData.summaryInfo.financialStatementAuditStatus) {
          expect(["Audited", "Reviewed", "Prepared", "Unaudited"]).toContain(
            form1A.formData.summaryInfo.financialStatementAuditStatus
          );
        }

        // Test yes/no flags
        if (form1A.formData.summaryInfo.offerDelayedContinuousFlag) {
          expect(["Y", "N"]).toContain(form1A.formData.summaryInfo.offerDelayedContinuousFlag);
        }
        if (form1A.formData.summaryInfo.offeringYearFlag) {
          expect(["Y", "N"]).toContain(form1A.formData.summaryInfo.offeringYearFlag);
        }
        if (form1A.formData.summaryInfo.offeringAfterQualifFlag) {
          expect(["Y", "N"]).toContain(form1A.formData.summaryInfo.offeringAfterQualifFlag);
        }
        if (form1A.formData.summaryInfo.offeringBestEffortsFlag) {
          expect(["Y", "N"]).toContain(form1A.formData.summaryInfo.offeringBestEffortsFlag);
        }
        if (form1A.formData.summaryInfo.solicitationProposedOfferingFlag) {
          expect(["Y", "N"]).toContain(
            form1A.formData.summaryInfo.solicitationProposedOfferingFlag
          );
        }
        if (form1A.formData.summaryInfo.resaleSecuritiesAffiliatesFlag) {
          expect(["Y", "N"]).toContain(form1A.formData.summaryInfo.resaleSecuritiesAffiliatesFlag);
        }
      }
    });

    it("should validate jurisdiction codes", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1A = await Form_1_A.parse("1-A", xmlContent);

        // Test jurisdiction of organization
        if (form1A.formData.employeesInfo[0].jurisdictionOrganization) {
          expect(form1A.formData.employeesInfo[0].jurisdictionOrganization).toMatch(/^[A-Z]{2}$/);
        }

        // Test state or country in issuer info
        if (form1A.formData.issuerInfo.stateOrCountry) {
          expect(form1A.formData.issuerInfo.stateOrCountry).toMatch(/^[A-Z0-9]{2}$/);
        }

        // Test jurisdiction securities offered
        if (form1A.formData.juridictionSecuritiesOffered?.issueJuridicationSecuritiesOffering) {
          form1A.formData.juridictionSecuritiesOffered.issueJuridicationSecuritiesOffering.forEach(
            (jurisdiction) => {
              expect(jurisdiction).toMatch(/^[A-Z0-9]{2}$/);
            }
          );
        }

        if (form1A.formData.juridictionSecuritiesOffered?.dealersJuridicationSecuritiesOffering) {
          form1A.formData.juridictionSecuritiesOffered.dealersJuridicationSecuritiesOffering.forEach(
            (jurisdiction) => {
              expect(jurisdiction).toMatch(/^[A-Z0-9]{2}$/);
            }
          );
        }
      }
    });

    it("should validate financial data types and ranges", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1A = await Form_1_A.parse("1-A", xmlContent);

        // Test financial amounts are numbers
        const financialFields = [
          form1A.formData.issuerInfo.cashEquivalents,
          form1A.formData.issuerInfo.investmentSecurities,
          form1A.formData.issuerInfo.accountsReceivable,
          form1A.formData.issuerInfo.propertyPlantEquipment,
          form1A.formData.issuerInfo.totalAssets,
          form1A.formData.issuerInfo.accountsPayable,
          form1A.formData.issuerInfo.longTermDebt,
          form1A.formData.issuerInfo.totalLiabilities,
          form1A.formData.issuerInfo.totalStockholderEquity,
          form1A.formData.issuerInfo.totalLiabilitiesAndEquity,
          form1A.formData.issuerInfo.totalRevenues,
          form1A.formData.issuerInfo.costAndExpensesApplToRevenues,
          form1A.formData.issuerInfo.depreciationAndAmortization,
          form1A.formData.issuerInfo.netIncome,
          form1A.formData.issuerInfo.earningsPerShareBasic,
          form1A.formData.issuerInfo.earningsPerShareDiluted,
          form1A.formData.summaryInfo.securitiesOffered,
          form1A.formData.summaryInfo.outstandingSecurities,
          form1A.formData.summaryInfo.pricePerSecurity,
          form1A.formData.summaryInfo.issuerAggregateOffering,
          form1A.formData.summaryInfo.securityHolderAggegate,
          form1A.formData.summaryInfo.qualificationOfferingAggregate,
          form1A.formData.summaryInfo.concurrentOfferingAggregate,
          form1A.formData.summaryInfo.totalAggregateOffering,
          form1A.formData.summaryInfo.auditorFees,
          form1A.formData.summaryInfo.legalFees,
          form1A.formData.summaryInfo.estimatedNetAmount,
        ];

        financialFields.forEach((value) => {
          if (value !== undefined && value !== null) {
            expect(typeof value).toBe("number");
          }
        });

        // Test employee counts are non-negative integers
        if (form1A.formData.employeesInfo[0].fullTimeEmployees !== undefined) {
          expect(form1A.formData.employeesInfo[0].fullTimeEmployees).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(form1A.formData.employeesInfo[0].fullTimeEmployees)).toBe(true);
        }

        if (form1A.formData.employeesInfo[0].partTimeEmployees !== undefined) {
          expect(form1A.formData.employeesInfo[0].partTimeEmployees).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(form1A.formData.employeesInfo[0].partTimeEmployees)).toBe(true);
        }

        // Test year incorporation is reasonable
        if (form1A.formData.employeesInfo[0].yearIncorporation !== undefined) {
          expect(form1A.formData.employeesInfo[0].yearIncorporation).toBeGreaterThan(1800);
          expect(form1A.formData.employeesInfo[0].yearIncorporation).toBeLessThanOrEqual(
            new Date().getFullYear()
          );
        }
      }
    });

    it("should validate industry groups", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      const industryGroups = new Set<string>();

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1A = await Form_1_A.parse("1-A", xmlContent);

        if (form1A.formData.issuerInfo.industryGroup) {
          industryGroups.add(form1A.formData.issuerInfo.industryGroup);
        }
      }

      console.log("Found industry groups:", Array.from(industryGroups));

      // Validate industry groups are valid types
      const validIndustryGroups = [
        "Banking and Financial Services",
        "Commercial",
        "Energy",
        "Manufacturing",
        "Real Estate and Construction",
        "Retailing",
        "Technology",
        "Other",
      ];

      industryGroups.forEach((group) => {
        expect(validIndustryGroups).toContain(group);
      });
    });

    it("should validate SIC codes", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1A = await Form_1_A.parse("1-A", xmlContent);

        if (form1A.formData.employeesInfo[0].sicCode) {
          // SIC codes should be 4 digits
          expect(form1A.formData.employeesInfo[0].sicCode.toString()).toMatch(/^\d{4}$/);
        }
      }
    });
  });
});
