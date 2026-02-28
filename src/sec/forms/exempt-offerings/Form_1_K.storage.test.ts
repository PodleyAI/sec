/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_1_K } from "./Form_1_K";
import { processForm1K } from "./Form_1_K.storage";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";

describe("Form_1_K storage test", () => {
  let companyRepo: CompanyRepo;
  let addressRepo: AddressRepo;
  let phoneRepo: PhoneRepo;
  let regARepo: RegAOfferingRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    companyRepo = new CompanyRepo();
    addressRepo = new AddressRepo();
    phoneRepo = new PhoneRepo();
    regARepo = new RegAOfferingRepo();
  });

  describe("Form 1-K parsing and storage with all mock data", () => {
    it("should parse and store all Form 1-K files from mock_data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
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
          const form1K = await Form_1_K.parse("1-K", xmlContent);
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const primaryIssuer = form1K.formData.item1Info[0];
          const cik = primaryIssuer?.cik ? parseInt(primaryIssuer.cik) : 12345;
          const fileNumber =
            form1K.headerData.filerInfo.filer.fileNumber || `024-${accessionNumber.slice(0, 5)}`;

          await processForm1K({
            cik,
            file_number: fileNumber,
            accession_number: accessionNumber,
            filing_date: "2024-06-15",
            primary_doc: file,
            form1K,
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

      // All 1-K offerings should be in "reporting" status
      for (const offering of allOfferings) {
        expect(offering.status).toBe("reporting");
      }
    });

    it("should store offering history with correct data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1K = await Form_1_K.parse("1-K", xmlContent);
      const primaryIssuer = form1K.formData.item1Info[0];
      const cik = primaryIssuer?.cik ? parseInt(primaryIssuer.cik) : 12345;
      const fileNumber = "024-test-001";

      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: "test-accession-1k",
        filing_date: "2024-06-15",
        primary_doc: xmlFiles[0],
        form1K,
      });

      // Check offering was created
      const offering = await regARepo.getOffering(cik, fileNumber);
      expect(offering).toBeDefined();
      expect(offering?.status).toBe("reporting");

      // Check history was stored if summaryInfo exists
      if (form1K.formData.summaryInfo) {
        const histories = (await regARepo.offeringHistoryRepository.getAll()) || [];
        expect(histories.length).toBeGreaterThan(0);
      }
    });

    it("should store service providers from summary info", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      // Find a file that has service providers
      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1K = await Form_1_K.parse("1-K", xmlContent);

        if (form1K.formData.summaryInfo?.some((si) => si.auditorSpName || si.legalSpName)) {
          const primaryIssuer = form1K.formData.item1Info[0];
          const cik = primaryIssuer?.cik ? parseInt(primaryIssuer.cik) : 12345;
          const fileNumber = "024-sp-test";

          await processForm1K({
            cik,
            file_number: fileNumber,
            accession_number: "test-sp-accession",
            filing_date: "2024-06-15",
            primary_doc: file,
            form1K,
          });

          // Service providers may use commissionFileNumber from summary info
          // instead of the passed file_number, so check all providers for this CIK
          const allProviders = (await regARepo.serviceProviderRepository.getAll()) || [];
          const cikProviders = allProviders.filter((sp) => sp.cik === cik);
          expect(cikProviders.length).toBeGreaterThan(0);
          break;
        }
      }
    });

    it("should store issuer address and phone from item1", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1K = await Form_1_K.parse("1-K", xmlContent);
      const primaryIssuer = form1K.formData.item1Info[0];
      const cik = primaryIssuer?.cik ? parseInt(primaryIssuer.cik) : 12345;

      await processForm1K({
        cik,
        file_number: "024-addr-test",
        accession_number: "test-addr-accession",
        filing_date: "2024-06-15",
        primary_doc: xmlFiles[0],
        form1K,
      });

      const allAddresses = (await addressRepo.addressRepository.getAll()) || [];
      expect(allAddresses.length).toBeGreaterThan(0);

      const allPhones = (await phoneRepo.phoneRepository.getAll()) || [];
      expect(allPhones.length).toBeGreaterThan(0);
    });
  });
});
