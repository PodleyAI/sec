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
import { CrowdfundingRepo } from "../../../storage/portal/CrowdfundingRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";

describe("Form_C storage test", () => {
  let addressRepo: AddressRepo;
  let crowdfundingRepo: CrowdfundingRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
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

      // Verify companies were stored via observation tier
      const allCompanies = await new CompanyObservationRepo().listAll();
      expect(allCompanies.length).toBeGreaterThan(0);
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

      // Verify co-issuers were stored as company observations
      const allCompanyObs = await new CompanyObservationRepo().listAll();
      const coIssuerObs = allCompanyObs.filter((o) => {
        try {
          return JSON.parse(o.source_context ?? "{}").relation === "form-c:co-issuer";
        } catch {
          return false;
        }
      });
      expect(coIssuerObs.length).toBe(2);
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

      // The issuer signature should be stored as a person observation
      const allPersonObs = await new PersonObservationRepo().listAll();
      const signatureObs = allPersonObs.filter((o) => o.relationship === "form-c:signature");
      expect(signatureObs.length).toBeGreaterThan(0);
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

    // Plan H regression guard for Form C: empty/whitespace offering &
    // disclosure numerics must persist as null; "0" must round-trip.

    it("treats whitespace-only offering numerics as null (not fabricated 0)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");
      const formC = await Form_C.parse("C", xmlContent);

      // Mutate the parsed object so the leaves we care about are whitespace.
      const offeringInfo = formC.formData.offeringInformation as
        | Record<string, unknown>
        | undefined;
      if (offeringInfo) {
        offeringInfo.price = "   ";
        offeringInfo.offeringAmount = "   ";
        offeringInfo.maximumOfferingAmount = "   ";
      }
      const disclosures = formC.formData.annualReportDisclosureRequirements as
        | Record<string, unknown>
        | undefined;
      if (disclosures) {
        disclosures.totalAssetMostRecentFiscalYear = "   ";
      }

      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
      const fileNumber = "020-h-ws-c";
      const filingDate = "2024-01-15";
      await processFormC({
        cik,
        file_number: fileNumber,
        accession_number: "test-h-ws-c",
        filing_date: filingDate,
        primary_doc: xmlFiles[0],
        formC,
      });

      const offering = await crowdfundingRepo.getCrowdfundingOffering(
        cik,
        fileNumber,
        filingDate
      );
      expect(offering?.price).toBe(null);
      expect(offering?.offering_amount).toBe(null);
      expect(offering?.maximum_offering_amount).toBe(null);

      if (disclosures) {
        const reports = (await crowdfundingRepo.getCrowdfundingReportsByCik(cik)).filter(
          (r) => r.file_number === fileNumber
        );
        expect(
          reports.find((r) => r.disclosure_name === "totalAssetMostRecentFiscalYear")
        ).toBeUndefined();
      }
    });

    it("treats empty offering numerics as null (not fabricated 0)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");
      const formC = await Form_C.parse("C", xmlContent);

      const offeringInfo = formC.formData.offeringInformation as
        | Record<string, unknown>
        | undefined;
      if (offeringInfo) {
        offeringInfo.price = "";
        offeringInfo.offeringAmount = "";
      }

      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
      const fileNumber = "020-h-empty-c";
      const filingDate = "2024-01-16";
      await processFormC({
        cik,
        file_number: fileNumber,
        accession_number: "test-h-empty-c",
        filing_date: filingDate,
        primary_doc: xmlFiles[0],
        formC,
      });

      const offering = await crowdfundingRepo.getCrowdfundingOffering(
        cik,
        fileNumber,
        filingDate
      );
      expect(offering?.price).toBe(null);
      expect(offering?.offering_amount).toBe(null);
    });

    it("preserves legitimate '0' offering numerics as DB value 0", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");
      const formC = await Form_C.parse("C", xmlContent);

      const offeringInfo = formC.formData.offeringInformation as
        | Record<string, unknown>
        | undefined;
      if (offeringInfo) {
        offeringInfo.price = "0";
        offeringInfo.offeringAmount = "0";
      }
      const disclosures = formC.formData.annualReportDisclosureRequirements as
        | Record<string, unknown>
        | undefined;
      if (disclosures) {
        disclosures.totalAssetMostRecentFiscalYear = "0";
      }

      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
      const fileNumber = "020-h-zero-c";
      const filingDate = "2024-01-17";
      await processFormC({
        cik,
        file_number: fileNumber,
        accession_number: "test-h-zero-c",
        filing_date: filingDate,
        primary_doc: xmlFiles[0],
        formC,
      });

      const offering = await crowdfundingRepo.getCrowdfundingOffering(
        cik,
        fileNumber,
        filingDate
      );
      expect(offering?.price).toBe(0);
      expect(offering?.offering_amount).toBe(0);

      if (disclosures) {
        const reports = (await crowdfundingRepo.getCrowdfundingReportsByCik(cik)).filter(
          (r) => r.file_number === fileNumber
        );
        const totalAsset = reports.find(
          (r) => r.disclosure_name === "totalAssetMostRecentFiscalYear"
        );
        expect(totalAsset?.disclosure_value).toBe(0);
      }
    });

    // Regression guard: `currentEmployees` is schema-typed
    // DECIMAL_TYPE7_2_NONNEGATIVE. The string-decimal migration moved
    // the parse-time `minimum: 0` invariant into storage. A malformed
    // feed with a negative value must not produce a disclosure row
    // (the negative count would silently surface in reports).
    it("rejects negative currentEmployees as null (not stored)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-c");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");
      const formC = await Form_C.parse("C", xmlContent);

      const disclosures = formC.formData.annualReportDisclosureRequirements as
        | Record<string, unknown>
        | undefined;
      expect(disclosures).toBeDefined();
      if (!disclosures) return;
      disclosures.currentEmployees = "-1";

      const cik = parseInt(formC.headerData.filerInfo.filer.filerCredentials.filerCik);
      const fileNumber = "020-h-neg-ce";
      const filingDate = "2024-01-18";
      await processFormC({
        cik,
        file_number: fileNumber,
        accession_number: "test-h-neg-ce",
        filing_date: filingDate,
        primary_doc: xmlFiles[0],
        formC,
      });

      const reports = (await crowdfundingRepo.getCrowdfundingReportsByCik(cik)).filter(
        (r) => r.file_number === fileNumber
      );
      // The negative value must be dropped rather than stored as -1.
      expect(
        reports.find((r) => r.disclosure_name === "currentEmployees")
      ).toBeUndefined();
    });
  });
});
