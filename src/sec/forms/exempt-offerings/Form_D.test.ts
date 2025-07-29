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
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { InvestmentOfferingRepo } from "../../../storage/investment-offering/InvestmentOfferingRepo";
import { IssuerRepo } from "../../../storage/investment-offering/IssuerRepo";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";

describe("Form_D comprehensive storage test", () => {
  let companyRepo: CompanyRepo;
  let personRepo: PersonRepo;
  let addressRepo: AddressRepo;
  let phoneRepo: PhoneRepo;
  let investmentOfferingRepo: InvestmentOfferingRepo;
  let issuerRepo: IssuerRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    companyRepo = new CompanyRepo();
    personRepo = new PersonRepo();
    addressRepo = new AddressRepo();
    phoneRepo = new PhoneRepo();
    investmentOfferingRepo = new InvestmentOfferingRepo();
    issuerRepo = new IssuerRepo();
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
      const allCompanies = (await companyRepo.companyRepository.getAll())?.length || 0;
      const allPersons = (await personRepo.personRepository.getAll())?.length || 0;
      const allAddresses = (await addressRepo.addressRepository.getAll())?.length || 0;
      const allPhones = (await phoneRepo.phoneRepository.getAll())?.length || 0;
      const allOfferings =
        (await investmentOfferingRepo.investmentOfferingRepository.getAll())?.length || 0;
      const allOfferingHistories =
        (await investmentOfferingRepo.investmentOfferingHistoryRepository.getAll())?.length || 0;
      const allIssuers = (await issuerRepo.issuerRepository.getAll())?.length || 0;
      const allCompanyPreviousNames =
        (await companyRepo.companyPreviousNamesRepository.getAll())?.length || 0;

      // Verify we have data in each repository
      expect(allCompanies).toBe(30);
      expect(allPersons).toBe(52);
      expect(allAddresses).toBe(30);
      expect(allOfferings).toBe(20);
      expect(allOfferingHistories).toBe(20);
      expect(allPhones).toBe(18);
      expect(allIssuers).toBe(3);
      expect(allCompanyPreviousNames).toBe(8);
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

      // Verify that "Jordan Park Access Solutions GP LLC" was stored as a company, not a person
      const allCompanies = await companyRepo.companyRepository.getAll();
      const jordanParkCompany = allCompanies?.find((company) =>
        company.company_name.includes("Jordan Park Access Solutions")
      );

      expect(jordanParkCompany).toBeDefined();

      // Verify company-entity relationships were created
      const companyRelations = await companyRepo.companyEntityJunctionRepository.search({ cik });
      expect(companyRelations?.length || 0).toBeGreaterThan(0);
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
      const offerings = await investmentOfferingRepo.investmentOfferingRepository.search({ cik });
      expect(offerings?.length || 0).toBeGreaterThan(0);

      const offering = offerings?.[0];
      expect(offering?.industry_group).toBe("Commercial");
      expect(offering?.is_equity_type).toBe(true);

      // Verify investment offering history was stored
      const histories = await investmentOfferingRepo.investmentOfferingHistoryRepository.search({
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

      // Verify signers were stored as persons with correct relationships
      const allPersons = await personRepo.personRepository.getAll();
      const sharlaLangston = allPersons?.find(
        (person) => person.first === "Sharla" && person.last === "Langston"
      );

      expect(sharlaLangston).toBeDefined();

      // Verify signature relationship was created
      const signatureRelations = await personRepo.personEntityJunctionRepository.search({
        cik,
        relation_name: "form-d:signature",
      });
      expect(signatureRelations?.length || 0).toBe(1);

      const signatureRelation = signatureRelations?.[0];
      expect(signatureRelation?.titles).toContain("Attorney-in-fact");
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

      // Verify company with CRD number was stored
      const allCompanies = await companyRepo.companyRepository.getAll();
      const thornhillCompany = allCompanies?.find((company) =>
        company.company_name.includes("Thornhill Securities")
      );
      expect(thornhillCompany).toBeDefined();
      expect(thornhillCompany?.crd).toBe("22333");

      // Verify person with CRD number was stored
      const allPersons = await personRepo.personRepository.getAll();
      const robertAnderson = allPersons?.find(
        (person) => person.first === "Robert" && person.last === "Anderson"
      );
      expect(robertAnderson).toBeDefined();
      expect(robertAnderson?.crd).toBe("3101064");

      // Verify sales compensation relationships were created
      const companyRelations = await companyRepo.companyEntityJunctionRepository.search({
        cik,
        relation_name: "form-d:sales-compensation",
      });
      expect(companyRelations?.length || 0).toBeGreaterThan(0);

      const personRelations = await personRepo.personEntityJunctionRepository.search({
        cik,
        relation_name: "form-d:sales-compensation",
      });
      expect(personRelations?.length || 0).toBeGreaterThan(0);
    });

    it("should store previous names correctly", async () => {
      // Test a file that has previous names
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

      // Check if previous names were stored for companies
      const allCompanyPreviousNames = await companyRepo.companyPreviousNamesRepository.getAll();
      expect(allCompanyPreviousNames?.length || 0).toBeGreaterThan(0);

      // Find a specific previous name
      const jordanParkPrevName = allCompanyPreviousNames?.find((prev) =>
        prev.previous_name.includes("Jordan Park Private Capital I L.P.")
      );
      expect(jordanParkPrevName).toBeDefined();
      expect(jordanParkPrevName?.name_type).toBe("issuer");
      expect(jordanParkPrevName?.source).toBe("Form D");

      // Check for additional issuer previous names
      const additionalIssuerPrevName = allCompanyPreviousNames?.find((prev) =>
        prev.previous_name.includes("Jordan Park Private Capital 1-A L.P.")
      );
      expect(additionalIssuerPrevName).toBeDefined();
      expect(additionalIssuerPrevName?.name_type).toBe("issuer");
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

      // Verify persons were stored
      const allPersons = await personRepo.personRepository.getAll();
      const frankGhali = allPersons?.find(
        (person) => person.first === "Frank" && person.last === "Ghali"
      );

      expect(frankGhali?.first).toBe("Frank");
      expect(frankGhali?.last).toBe("Ghali");

      // Verify person-entity relationships
      const personRelations = await personRepo.personEntityJunctionRepository.search({ cik });
      expect(personRelations?.length || 0).toBe(6); // Original 5 + 1 signer

      // Verify addresses were linked to persons
      const personAddressLinks = await personRepo.personAddressJunctionRepository.getAll();
      expect(personAddressLinks?.length || 0).toBe(5);
    });
  });
});
