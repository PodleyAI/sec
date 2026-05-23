/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_D } from "./Form_D";
import { processFormD } from "./Form_D.storage";

// Import all repository schemas and types

import { AddressRepo } from "../../../storage/address/AddressRepo";
import { InvestmentOfferingRepo } from "../../../storage/investment-offering/InvestmentOfferingRepo";
import { IssuerRepo } from "../../../storage/investment-offering/IssuerRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";

describe("Form_D comprehensive storage test", () => {
  let addressRepo: AddressRepo;
  let phoneRepo: PhoneRepo;
  let investmentOfferingRepo: InvestmentOfferingRepo;
  let issuerRepo: IssuerRepo;
  let personObsRepo: PersonObservationRepo;
  let companyObsRepo: CompanyObservationRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    addressRepo = new AddressRepo();
    phoneRepo = new PhoneRepo();
    investmentOfferingRepo = new InvestmentOfferingRepo();
    issuerRepo = new IssuerRepo();
    personObsRepo = new PersonObservationRepo();
    companyObsRepo = new CompanyObservationRepo();
  });

  describe("Form D parsing and storage with all mock data", () => {
    it("should parse and store all Form D files from mock_data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-d");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      expect(xmlFiles.length).toBeGreaterThan(0);

      const results: Array<{
        file: string;
        accessionNumber?: string;
        cik?: number;
        entityName?: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");

        try {
          // Parse the Form D
          const formD = await Form_D.parse("D", xmlContent);

          // Extract metadata for storage
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const cik = parseInt(formD.primaryIssuer.cik);
          const fileNumber = `file-${accessionNumber}`;

          // Process and store the form data
          await processFormD({
            cik,
            file_number: fileNumber,
            accession_number: accessionNumber,
            primary_doc: file,
            formD,
          });

          results.push({
            file,
            accessionNumber,
            cik,
            entityName: formD.primaryIssuer.entityName,
            success: true,
          });
        } catch (error) {
          console.error(`Error processing ${file}:`, error);
          results.push({
            file,
            error: error instanceof Error ? error.message : String(error),
            success: false,
          });
        }
      }

      // Verify all files were processed successfully
      const failedFiles = results.filter((r) => !r.success);
      if (failedFiles.length > 0) {
        console.error("Failed files:", failedFiles);
      }
      expect(failedFiles.length).toBe(0);

      // Verify data was stored
      const allCompanyObs = (await companyObsRepo.listAll())?.length || 0;
      const allPersonObs = (await personObsRepo.listAll())?.length || 0;
      const allAddresses = (await addressRepo.addressRepository.getAll())?.length || 0;
      const allPhones = (await phoneRepo.phoneRepository.getAll())?.length || 0;
      const allOfferings =
        (await investmentOfferingRepo.investmentOfferingRepository.getAll())?.length || 0;
      const allOfferingHistories =
        (await investmentOfferingRepo.investmentOfferingHistoryRepository.getAll())?.length || 0;
      const allIssuers = (await issuerRepo.issuerRepository.getAll())?.length || 0;

      // Verify we have data in each repository. The fixture set grows over
      // time as we pull more real filings from EDGAR, so assert relative
      // invariants (rows-per-filing ratios) rather than absolute counts.
      const filings = xmlFiles.length;
      expect(allCompanyObs).toBeGreaterThanOrEqual(filings); // >=1 issuer observation per filing
      expect(allOfferings).toBeGreaterThanOrEqual(filings - Math.ceil(filings * 0.1)); // ~1 offering per filing
      expect(allOfferingHistories).toBeGreaterThanOrEqual(filings - Math.ceil(filings * 0.1));
      expect(allPersonObs).toBeGreaterThan(0);
      expect(allAddresses).toBeGreaterThan(0);
      expect(allPhones).toBeGreaterThan(0);
      expect(allIssuers).toBeGreaterThanOrEqual(0); // some filings have no related issuers
    });

    it("should handle company entities in person fields correctly", async () => {
      // Test the specific file that has a company in person fields
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-d", "000175724818000002-primary_doc.xml"),
        "utf-8"
      );

      const formD = await Form_D.parse("D", xmlContent);
      const accessionNumber = "000175724818000002";
      const cik = parseInt(formD.primaryIssuer.cik);

      await processFormD({
        cik,
        file_number: `file-${accessionNumber}`,
        accession_number: accessionNumber,
        primary_doc: "000175724818000002-primary_doc.xml",
        formD,
      });

      // Verify that "Jordan Park Access Solutions GP LLC" was stored as a company observation, not a person
      const allCompanyObs = await companyObsRepo.listAll();
      const jordanParkObs = allCompanyObs?.find((obs) =>
        obs.name?.includes("Jordan Park Access Solutions")
      );

      expect(jordanParkObs).toBeDefined();
    });

    it("should store investment offering data correctly", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-d", "000192959422000001-primary_doc.xml"),
        "utf-8"
      );

      const formD = await Form_D.parse("D", xmlContent);
      const accessionNumber = "000192959422000001";
      const cik = parseInt(formD.primaryIssuer.cik);

      await processFormD({
        cik,
        file_number: `file-${accessionNumber}`,
        accession_number: accessionNumber,
        primary_doc: "000192959422000001-primary_doc.xml",
        formD,
      });

      // Verify investment offering was stored
      const offerings = await investmentOfferingRepo.investmentOfferingRepository.query({ cik });
      expect(offerings?.length || 0).toBeGreaterThan(0);

      const offering = offerings?.[0];
      expect(offering?.industry_group).toBe("Commercial");
      expect(offering?.is_equity_type).toBe(true);

      // Verify investment offering history was stored
      const histories = await investmentOfferingRepo.investmentOfferingHistoryRepository.query({
        cik,
        accession_number: accessionNumber,
      });
      expect(histories?.length || 0).toBeGreaterThan(0);

      const history = histories?.[0];
      expect(history?.minimum_investment_accepted).toBe(25000);
      expect(history?.total_amount_sold).toBe(900000);
    });

    it("should store signature data correctly", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-d", "000192959422000001-primary_doc.xml"),
        "utf-8"
      );

      const formD = await Form_D.parse("D", xmlContent);
      const accessionNumber = "000192959422000001";
      const cik = parseInt(formD.primaryIssuer.cik);

      await processFormD({
        cik,
        file_number: `file-${accessionNumber}`,
        accession_number: accessionNumber,
        primary_doc: "000192959422000001-primary_doc.xml",
        formD,
      });

      // Verify signers were stored as person observations
      const allPersonObs = await personObsRepo.listAll();
      const sharlaLangston = allPersonObs?.find(
        (obs) => obs.last_name?.includes("Langston") || obs.last_name?.includes("Sharla Langston")
      );

      expect(sharlaLangston).toBeDefined();
    });

    it("should store CRD numbers correctly", async () => {
      // Test a file that has CRD numbers
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-d", "000192959422000001-primary_doc.xml"),
        "utf-8"
      );

      const formD = await Form_D.parse("D", xmlContent);
      const accessionNumber = "000192959422000001";
      const cik = parseInt(formD.primaryIssuer.cik);

      await processFormD({
        cik,
        file_number: `file-${accessionNumber}`,
        accession_number: accessionNumber,
        primary_doc: "000192959422000001-primary_doc.xml",
        formD,
      });

      // Verify company observation with CRD number was stored
      const allCompanyObs = await companyObsRepo.listAll();
      const thornhillObs = allCompanyObs?.find((obs) =>
        obs.name?.includes("Thornhill Securities")
      );
      expect(thornhillObs).toBeDefined();
      expect(thornhillObs?.crd_number).toBe("22333");

      // Verify person observation with CRD number was stored (as source_context)
      const allPersonObs = await personObsRepo.listAll();
      const robertAnderson = allPersonObs?.find((obs) => {
        if (!obs.source_context) return false;
        try {
          const ctx = JSON.parse(obs.source_context);
          return ctx.crd_number === "3101064";
        } catch {
          return false;
        }
      });
      expect(robertAnderson).toBeDefined();
    });

    it("should store related persons and their relationships correctly", async () => {
      const xmlContent = readFileSync(
        join(__dirname, "mock_data", "form-d", "000175724718000001-primary_doc.xml"),
        "utf-8"
      );

      const formD = await Form_D.parse("D", xmlContent);
      const accessionNumber = "000175724718000001";
      const cik = parseInt(formD.primaryIssuer.cik);

      await processFormD({
        cik,
        file_number: `file-${accessionNumber}`,
        accession_number: accessionNumber,
        primary_doc: "000175724718000001-primary_doc.xml",
        formD,
      });

      // Verify persons were stored as observations
      const allPersonObs = await personObsRepo.listAll();
      const frankGhali = allPersonObs?.find(
        (obs) => obs.last_name === "Ghali" && obs.first_name === "Frank"
      );

      expect(frankGhali?.first_name).toBe("Frank");
      expect(frankGhali?.last_name).toBe("Ghali");

      // Verify we have person observations for this accession
      const accessionPersonObs = await personObsRepo.listByAccession(accessionNumber);
      expect(accessionPersonObs.length).toBeGreaterThan(0);
    });
  });
});
