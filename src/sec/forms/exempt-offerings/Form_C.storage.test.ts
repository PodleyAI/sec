/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_C } from "./Form_C";
import { processFormC } from "./Form_C.storage";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { CrowdfundingRepo } from "../../../storage/portal/CrowdfundingRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";

describe("Form_C storage test", () => {
  let companyRepo: CompanyRepo;
  let personRepo: PersonRepo;
  let addressRepo: AddressRepo;
  let crowdfundingRepo: CrowdfundingRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    companyRepo = new CompanyRepo();
    personRepo = new PersonRepo();
    addressRepo = new AddressRepo();
    crowdfundingRepo = new CrowdfundingRepo();
  });

  describe("Form C parsing and storage with all mock data", () => {
    it("should parse and store all Form C files from mock_data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      expect(xmlFiles.length).toBeGreaterThan(0);

      const results: Array<{
        file: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");

        try {
          const formC = await Form_C.parse("C", xmlContent);
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
          const fileNumber = `020-${accessionNumber.slice(0, 5)}`;

          await processFormC({
            cik,
            file_number: fileNumber,
            accession_number: accessionNumber,
            filing_date: "2024-01-15",
            primary_doc: file,
            formC,
          });

          results.push({ file, success: true });
        } catch (error) {
          console.error(`Error processing ${file}:`, error);
          results.push({
            file,
            error: error instanceof Error ? error.message : String(error),
            success: false,
          });
        }
      }

      const failedFiles = results.filter((r) => !r.success);
      if (failedFiles.length > 0) {
        console.error("Failed files:", failedFiles);
      }
      expect(failedFiles.length).toBe(0);

      // Verify crowdfunding data was stored
      const allCrowdfunding = await crowdfundingRepo.getAllCrowdfunding();
      expect(allCrowdfunding.length).toBeGreaterThan(0);

      // Verify companies were stored
      const allCompanies = (await companyRepo.companyRepository.getAll())?.length || 0;
      expect(allCompanies).toBeGreaterThan(0);
    });

    it("should store crowdfunding entity with correct fields", async () => {
      const testFile = "000167025422000972-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const formC = await Form_C.parse("C", xmlContent);
      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);

      await processFormC({
        cik,
        file_number: "020-12345",
        accession_number: "000167025422000972",
        filing_date: "2024-01-15",
        primary_doc: testFile,
        formC,
      });

      const crowdfunding = await crowdfundingRepo.getCrowdfunding(cik, "020-12345");
      expect(crowdfunding).toBeDefined();
      expect(crowdfunding?.name).toBe("Apsy Inc");
      expect(crowdfunding?.legal_status).toBe("Corporation");
      expect(crowdfunding?.state_jurisdiction).toBe("DE");
      expect(crowdfunding?.status).toBe("active");
    });

    it("should store offering information correctly", async () => {
      const testFile = "000167025422000972-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const formC = await Form_C.parse("C", xmlContent);
      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);

      await processFormC({
        cik,
        file_number: "020-12345",
        accession_number: "000167025422000972",
        filing_date: "2024-01-15",
        primary_doc: testFile,
        formC,
      });

      const offerings = await crowdfundingRepo.getCrowdfundingOfferingsByCik(cik);
      expect(offerings.length).toBe(1);

      const offering = offerings[0];
      expect(offering.security_offered_type).toBe("Other");
      expect(offering.offering_amount).toBe(50000.0);
      expect(offering.maximum_offering_amount).toBe(1000000.0);
    });

    it("should store annual report disclosures as report rows", async () => {
      const testFile = "000167025422000972-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const formC = await Form_C.parse("C", xmlContent);
      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);

      await processFormC({
        cik,
        file_number: "020-12345",
        accession_number: "000167025422000972",
        filing_date: "2024-01-15",
        primary_doc: testFile,
        formC,
      });

      const reports = await crowdfundingRepo.getCrowdfundingReportsByCik(cik);
      expect(reports.length).toBeGreaterThan(0);

      // Check that specific disclosure fields are stored
      const currentEmployees = reports.find((r) => r.disclosure_name === "currentEmployees");
      expect(currentEmployees).toBeDefined();
      expect(currentEmployees?.disclosure_value).toBe(4);

      const totalAssets = reports.find(
        (r) => r.disclosure_name === "totalAssetMostRecentFiscalYear"
      );
      expect(totalAssets).toBeDefined();
      expect(totalAssets?.disclosure_value).toBe(36580.0);
    });

    it("should store co-issuers as companies", async () => {
      const testFile = "000167025422000972-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const formC = await Form_C.parse("C", xmlContent);
      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);

      await processFormC({
        cik,
        file_number: "020-12345",
        accession_number: "000167025422000972",
        filing_date: "2024-01-15",
        primary_doc: testFile,
        formC,
      });

      // Verify co-issuer relationships were created
      const coIssuerRelations = await companyRepo.companyEntityJunctionRepository.search({
        cik,
        relation_name: "form-c:co-issuer",
      });
      expect(coIssuerRelations?.length || 0).toBe(2);
    });

    it("should store signature persons", async () => {
      const testFile = "000167025422000972-primary_doc.xml";
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlContent = readFileSync(join(mockDataDir, testFile), "utf-8");

      const formC = await Form_C.parse("C", xmlContent);
      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);

      await processFormC({
        cik,
        file_number: "020-12345",
        accession_number: "000167025422000972",
        filing_date: "2024-01-15",
        primary_doc: testFile,
        formC,
      });

      // The issuer signature should be stored
      const signatureRelations = await personRepo.personEntityJunctionRepository.search({
        cik,
        relation_name: "form-c:signature",
      });
      expect(signatureRelations?.length || 0).toBeGreaterThan(0);
    });

    it("should set amended status for C/A submissions", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const formC = await Form_C.parse("C", xmlContent);

        if (formC.headerData.submissionType.includes("/A")) {
          const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
          const fileNumber = `020-${file.slice(0, 5)}`;

          await processFormC({
            cik,
            file_number: fileNumber,
            accession_number: file.replace("-primary_doc.xml", ""),
            filing_date: "2024-01-15",
            primary_doc: file,
            formC,
          });

          const crowdfunding = await crowdfundingRepo.getCrowdfunding(cik, fileNumber);
          expect(crowdfunding?.status).toBe("amended");
          break; // Only need one
        }
      }
    });
  });
});
