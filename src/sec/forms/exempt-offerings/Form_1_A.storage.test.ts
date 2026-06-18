/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_1_A } from "./Form_1_A";
import { processForm1A } from "./Form_1_A.storage";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";

describe("Form_1_A storage test", () => {
  let addressRepo: AddressRepo;
  let phoneRepo: PhoneRepo;
  let regARepo: RegAOfferingRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    addressRepo = new AddressRepo();
    phoneRepo = new PhoneRepo();
    regARepo = new RegAOfferingRepo();
  });

  describe("Form 1-A parsing and storage with all mock data", () => {
    it("should parse and store all Form 1-A files from mock_data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
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
          const form1A = await Form_1_A.parse("1-A", xmlContent);
          const accessionNumber = file.replace("-primary_doc.xml", "");
          const cik = parseInt(form1A.formData.employeesInfo[0].cik);
          const fileNumber =
            form1A.headerData.filerInfo.filer.offeringFileNumber || `024-${accessionNumber.slice(0, 5)}`;

          await processForm1A({
            cik,
            file_number: fileNumber,
            accession_number: accessionNumber,
            filing_date: "2024-03-15",
            primary_doc: file,
            form1A,
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

      // Verify offering histories
      const allHistories = (await regARepo.offeringHistoryRepository.getAll()) || [];
      expect(allHistories.length).toBeGreaterThan(0);

      // Verify companies were stored via observation tier
      const allCompanies = await new CompanyObservationRepo().listAll();
      expect(allCompanies.length).toBeGreaterThan(0);
    });

    it("should store offering with correct tier and audit status", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);
      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-00001";

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: "test-accession-001",
        filing_date: "2024-03-15",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const offering = await regARepo.getOffering(cik, fileNumber);
      expect(offering).toBeDefined();
      expect(offering?.status).toBe("pending");
      expect(offering?.tier).toMatch(/^Tier[12]$/);
      expect(offering?.financial_statement_audit_status).toMatch(/^(Audited|Unaudited)$/);
      expect(offering?.issuer_name).toBeTruthy();
    });

    it("should store financial data as EAV rows", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);
      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-00001";
      const accessionNumber = "test-accession-002";

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-03-15",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const financialData = await regARepo.getFinancialDataByFiling(
        cik,
        fileNumber,
        accessionNumber
      );
      expect(financialData.length).toBeGreaterThan(0);

      // Should have standard balance sheet fields
      const fieldNames = financialData.map((d) => d.field_name);
      expect(fieldNames).toContain("totalAssets");
      expect(fieldNames).toContain("netIncome");
    });

    it("should store equity classes from form data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);
      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-00001";
      const accessionNumber = "test-accession-003";

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-03-15",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const equityClasses = await regARepo.getEquityClassesByFiling(
        cik,
        fileNumber,
        accessionNumber
      );
      expect(equityClasses.length).toBeGreaterThan(0);

      const equityTypes = equityClasses.map((e) => e.equity_type);
      expect(equityTypes).toContain("common");
    });

    it("should store service providers", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);
      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-00001";
      const accessionNumber = "test-accession-004";

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-03-15",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const serviceProviders = await regARepo.getServiceProvidersByFiling(
        cik,
        fileNumber,
        accessionNumber
      );
      // Service providers are optional but many 1-A forms have them
      if (form1A.formData.summaryInfo.auditorServiceProviderName) {
        expect(serviceProviders.length).toBeGreaterThan(0);
        const providerTypes = serviceProviders.map((sp) => sp.provider_type);
        expect(providerTypes).toContain("auditor");
      }
    });

    it("should store issuer address and phone", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);
      const cik = parseInt(form1A.formData.employeesInfo[0].cik);

      await processForm1A({
        cik,
        file_number: "024-00001",
        accession_number: "test-accession-005",
        filing_date: "2024-03-15",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const allAddresses = (await addressRepo.addressRepository.getAll()) || [];
      expect(allAddresses.length).toBeGreaterThan(0);

      const allPhones = (await phoneRepo.phoneRepository.getAll()) || [];
      expect(allPhones.length).toBeGreaterThan(0);
    });

    // Plan H regression guard: whitespace / empty numeric leaves must be
    // persisted as null (effectively dropped) rather than fabricated 0,
    // while a legitimate "0" must round-trip.

    it("treats whitespace-only numeric fields as null (not fabricated 0)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);
      // Mutate the parsed object so a known leaf is whitespace-only.
      // The schema is now Type.String() so any string is structurally
      // valid; numScalar() in storage is the gate.
      (form1A.formData.issuerInfo as Record<string, unknown>).cashEquivalents = "   ";
      (form1A.formData.summaryInfo as Record<string, unknown>).pricePerSecurity = "   ";

      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-00099";
      const accessionNumber = "test-h-ws";

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-03-15",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const financialData = await regARepo.getFinancialDataByFiling(
        cik,
        fileNumber,
        accessionNumber
      );
      // cashEquivalents was whitespace — must NOT show up at all (the
      // pre-fix bug would have written field_value: 0).
      expect(financialData.find((d) => d.field_name === "cashEquivalents")).toBeUndefined();

      // pricePerSecurity flows into RegAOfferingHistory.price_per_security.
      const history = await regARepo.offeringHistoryRepository.get({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
      });
      expect(history?.price_per_security).toBe(null);
    });

    it("treats empty numeric fields as null (not fabricated 0)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);
      (form1A.formData.issuerInfo as Record<string, unknown>).cashEquivalents = "";
      (form1A.formData.summaryInfo as Record<string, unknown>).pricePerSecurity = "";

      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-00098";
      const accessionNumber = "test-h-empty";

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-03-15",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const financialData = await regARepo.getFinancialDataByFiling(
        cik,
        fileNumber,
        accessionNumber
      );
      expect(financialData.find((d) => d.field_name === "cashEquivalents")).toBeUndefined();

      const history = await regARepo.offeringHistoryRepository.get({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
      });
      expect(history?.price_per_security).toBe(null);
    });

    it("preserves a legitimate '0' as DB value 0 (regression guard)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const form1A = await Form_1_A.parse("1-A", xmlContent);
      (form1A.formData.issuerInfo as Record<string, unknown>).cashEquivalents = "0";
      (form1A.formData.summaryInfo as Record<string, unknown>).pricePerSecurity = "0";

      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-00097";
      const accessionNumber = "test-h-zero";

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-03-15",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const financialData = await regARepo.getFinancialDataByFiling(
        cik,
        fileNumber,
        accessionNumber
      );
      const cashRow = financialData.find((d) => d.field_name === "cashEquivalents");
      expect(cashRow?.field_value).toBe(0);

      const history = await regARepo.offeringHistoryRepository.get({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
      });
      expect(history?.price_per_security).toBe(0);
    });

    // Regression guard: an undated filing must not clobber a dated RegA
    // mutable row. Filers occasionally submit 1-A variants with no SGML
    // header date. The mutable row stays anchored at the prior `as_of`;
    // the per-accession history row still records the undated replay.
    it("undated stale replay does not regress a dated RegA mutable row", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-a");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");
      const form1A = await Form_1_A.parse("1-A", xmlContent);
      const cik = parseInt(form1A.formData.employeesInfo[0].cik);
      const fileNumber = "024-stale-und";

      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: "test-1a-und-newer",
        filing_date: "2026-05-01",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const seeded = await regARepo.getOffering(cik, fileNumber);
      expect(seeded).toBeDefined();
      expect(seeded?.as_of).toBe("2026-05-01");

      // Undated replay (filer error). Any dated row must win.
      await processForm1A({
        cik,
        file_number: fileNumber,
        accession_number: "test-1a-und-replay",
        filing_date: "",
        primary_doc: xmlFiles[0],
        form1A,
      });

      const after = await regARepo.getOffering(cik, fileNumber);
      expect(after?.as_of).toBe("2026-05-01");
      expect(after?.tier).toBe(seeded!.tier);
      expect(after?.status).toBe(seeded!.status);
      expect(after?.issuer_name).toBe(seeded!.issuer_name);

      // Undated filing still produces a per-accession history row.
      const replayHistory = await regARepo.getOfferingHistory(
        cik,
        fileNumber,
        "test-1a-und-replay"
      );
      expect(replayHistory).toBeDefined();
    });
  });
});
