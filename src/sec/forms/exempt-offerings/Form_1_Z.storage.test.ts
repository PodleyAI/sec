/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_1_Z } from "./Form_1_Z";
import { processForm1Z } from "./Form_1_Z.storage";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";

describe("Form_1_Z storage test", () => {
  let companyRepo: CompanyRepo;
  let personRepo: PersonRepo;
  let addressRepo: AddressRepo;
  let phoneRepo: PhoneRepo;
  let regARepo: RegAOfferingRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    companyRepo = new CompanyRepo();
    personRepo = new PersonRepo();
    addressRepo = new AddressRepo();
    phoneRepo = new PhoneRepo();
    regARepo = new RegAOfferingRepo();
  });

  describe("Form 1-Z parsing and storage with all mock data", () => {
    it("should parse and store all Form 1-Z files from mock_data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
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
          const form1Z = await Form_1_Z.parse("1-Z", xmlContent);
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const cik = parseInt(form1Z.headerData.filerInfo.filer.issuerCredentials.cik);
          const fileNumber =
            form1Z.headerData.filerInfo.filer.fileNumber || `024-${accessionNumber.slice(0, 5)}`;

          await processForm1Z({
            cik,
            file_number: fileNumber,
            accession_number: accessionNumber,
            filing_date: "2024-09-15",
            primary_doc: file,
            form1Z,
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

      // Verify offerings were stored
      const allOfferings = (await regARepo.offeringRepository.getAll()) || [];
      expect(allOfferings.length).toBeGreaterThan(0);

      // All 1-Z offerings should have "exit" status
      for (const offering of allOfferings) {
        expect(offering.status).toBe("exit");
      }
    });

    it("should store signatures from signatureTab", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1Z = await Form_1_Z.parse("1-Z", xmlContent);
      const cik = parseInt(form1Z.headerData.filerInfo.filer.issuerCredentials.cik);

      await processForm1Z({
        cik,
        file_number: "024-sig-test",
        accession_number: "test-sig-accession",
        filing_date: "2024-09-15",
        primary_doc: xmlFiles[0],
        form1Z,
      });

      // Check that signature persons/companies were stored
      const personSignatures = await personRepo.personEntityJunctionRepository.search({
        cik,
        relation_name: "form-rega:signature",
      });
      const companySignatures = await companyRepo.companyEntityJunctionRepository.search({
        cik,
        relation_name: "form-rega:signature",
      });

      const totalSignatures = (personSignatures?.length || 0) + (companySignatures?.length || 0);
      expect(totalSignatures).toBeGreaterThan(0);
    });

    it("should store issuer address and phone", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1Z = await Form_1_Z.parse("1-Z", xmlContent);
      const cik = parseInt(form1Z.headerData.filerInfo.filer.issuerCredentials.cik);

      await processForm1Z({
        cik,
        file_number: "024-addr-test",
        accession_number: "test-addr-accession",
        filing_date: "2024-09-15",
        primary_doc: xmlFiles[0],
        form1Z,
      });

      const allAddresses = (await addressRepo.addressRepository.getAll()) || [];
      expect(allAddresses.length).toBeGreaterThan(0);

      const allPhones = (await phoneRepo.phoneRepository.getAll()) || [];
      expect(allPhones.length).toBeGreaterThan(0);

      // Verify issuer company was stored
      const issuerRelations = await companyRepo.companyEntityJunctionRepository.search({
        cik,
        relation_name: "form-rega:issuer",
      });
      expect(issuerRelations?.length || 0).toBeGreaterThan(0);
    });

    it("should store certification suspension data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      // Find a file with certification suspension data
      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

        if (
          form1Z.formData.certificationSuspension &&
          form1Z.formData.certificationSuspension.length > 0
        ) {
          const cik = parseInt(form1Z.headerData.filerInfo.filer.issuerCredentials.cik);
          const fileNumber = "024-cert-test";
          const accessionNumber = "test-cert-accession";

          await processForm1Z({
            cik,
            file_number: fileNumber,
            accession_number: accessionNumber,
            filing_date: "2024-09-15",
            primary_doc: file,
            form1Z,
          });

          const financialData = await regARepo.getFinancialDataByFiling(
            cik,
            fileNumber,
            accessionNumber
          );
          expect(financialData.length).toBeGreaterThan(0);

          // Check suspension-prefixed fields
          const suspensionFields = financialData.filter((d) =>
            d.field_name.startsWith("suspension_")
          );
          expect(suspensionFields.length).toBeGreaterThan(0);
          break;
        }
      }
    });

    it("should store offering summaries as history", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      // Find a file with summary info
      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);

        if (
          form1Z.formData.summaryInfoOffering &&
          form1Z.formData.summaryInfoOffering.length > 0
        ) {
          const cik = parseInt(form1Z.headerData.filerInfo.filer.issuerCredentials.cik);

          await processForm1Z({
            cik,
            file_number: "024-hist-test",
            accession_number: "test-hist-accession",
            filing_date: "2024-09-15",
            primary_doc: file,
            form1Z,
          });

          const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
          expect(histories.length).toBeGreaterThan(0);
          break;
        }
      }
    });
  });
});
