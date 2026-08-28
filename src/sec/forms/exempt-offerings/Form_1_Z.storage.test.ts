/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { Form_1_Z } from "./Form_1_Z";
import { processForm1Z } from "./Form_1_Z.storage";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";

describe("Form_1_Z storage test", () => {
  let addressRepo: AddressRepo;
  let regARepo: RegAOfferingRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    addressRepo = new AddressRepo();
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

      // Check that signature persons/companies were stored via observation tier
      const allPersonObs = await new PersonObservationRepo().listAll();
      const allCompanyObs = await new CompanyObservationRepo().listAll();
      const sigObs = [
        ...allPersonObs.filter((o) => o.relationship === "form-1z:signature"),
        ...allCompanyObs.filter((o) => {
          try {
            return JSON.parse(o.source_context ?? "{}").relation === "form-1z:signature";
          } catch {
            return false;
          }
        }),
      ];

      expect(sigObs.length).toBeGreaterThan(0);
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

      // Verify issuer company was stored via observation tier
      const companyObs = await new CompanyObservationRepo().listAll();
      const issuerObs = companyObs.filter((o) => {
        try {
          return JSON.parse(o.source_context ?? "{}").relation === "form-1z:issuer";
        } catch {
          return false;
        }
      });
      expect(issuerObs.length).toBeGreaterThan(0);
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
          form1Z.formData.summaryInfoOffering?.some(
            (item) => typeof item === "object" && item !== null
          )
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

    // Plan H regression guard for Form 1-Z.

    it("treats whitespace-only pricePerSecurity as null (not fabricated 0)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);
        const offerings = form1Z.formData.summaryInfoOffering;
        if (!offerings) continue;
        const target = offerings.find((o) => typeof o === "object" && o !== null);
        if (!target) continue;

        // Written through the widened view: `pricePerSecurity` is a declared
        // optional string on the parsed shape, and the case being set up is the
        // whitespace-only value a filer can actually put there.
        (target as Record<string, unknown>).pricePerSecurity = "   ";

        const cik = 990101;
        const fileNumber = "024-h-ws-z";
        const accessionNumber = "test-h-ws-z";
        await processForm1Z({
          cik,
          file_number: fileNumber,
          accession_number: accessionNumber,
          filing_date: "2024-09-15",
          primary_doc: file,
          form1Z,
        });

        const history = await regARepo.offeringHistoryRepository.get({
          cik,
          file_number: fileNumber,
          accession_number: accessionNumber,
        });
        expect(history?.price_per_security).toBe(null);
        return;
      }
    });

    it("treats empty pricePerSecurity as null (not fabricated 0)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);
        const offerings = form1Z.formData.summaryInfoOffering;
        if (!offerings) continue;
        const target = offerings.find((o) => typeof o === "object" && o !== null);
        if (!target) continue;
        (target as Record<string, unknown>).pricePerSecurity = "";

        const cik = 990102;
        const fileNumber = "024-h-empty-z";
        const accessionNumber = "test-h-empty-z";
        await processForm1Z({
          cik,
          file_number: fileNumber,
          accession_number: accessionNumber,
          filing_date: "2024-09-15",
          primary_doc: file,
          form1Z,
        });

        const history = await regARepo.offeringHistoryRepository.get({
          cik,
          file_number: fileNumber,
          accession_number: accessionNumber,
        });
        expect(history?.price_per_security).toBe(null);
        return;
      }
    });

    it("preserves a legitimate '0' pricePerSecurity as DB value 0", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const xmlContent = readFileSync(join(mockDataDir, file), "utf-8");
        const form1Z = await Form_1_Z.parse("1-Z", xmlContent);
        const offerings = form1Z.formData.summaryInfoOffering;
        if (!offerings) continue;
        const target = offerings.find((o) => typeof o === "object" && o !== null);
        if (!target) continue;
        (target as Record<string, unknown>).pricePerSecurity = "0";

        const cik = 990103;
        const fileNumber = "024-h-zero-z";
        const accessionNumber = "test-h-zero-z";
        await processForm1Z({
          cik,
          file_number: fileNumber,
          accession_number: accessionNumber,
          filing_date: "2024-09-15",
          primary_doc: file,
          form1Z,
        });

        const history = await regARepo.offeringHistoryRepository.get({
          cik,
          file_number: fileNumber,
          accession_number: accessionNumber,
        });
        expect(history?.price_per_security).toBe(0);
        return;
      }
    });

    it("undated stale replay does not regress a dated mutable row", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-z");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");
      const form1Z = await Form_1_Z.parse("1-Z", xmlContent);
      const cik = 990110;
      const fileNumber = "024-1z-und";

      await processForm1Z({
        cik,
        file_number: fileNumber,
        accession_number: "1z-dated-seed",
        filing_date: "2024-09-15",
        primary_doc: xmlFiles[0],
        form1Z,
      });

      const seeded = await regARepo.getOffering(cik, fileNumber);
      expect(seeded?.as_of).toBe("2024-09-15");
      const seededTier = seeded?.tier ?? null;
      const seededIssuerName = seeded?.issuer_name ?? null;
      const seededSicCode = seeded?.sic_code ?? null;

      // Undated replay (filer error). Any dated row must win.
      await processForm1Z({
        cik,
        file_number: fileNumber,
        accession_number: "1z-undated-replay",
        filing_date: "",
        primary_doc: xmlFiles[0],
        form1Z,
      });

      const after = await regARepo.getOffering(cik, fileNumber);
      expect(after?.as_of).toBe("2024-09-15");
      expect(after?.tier ?? null).toBe(seededTier);
      expect(after?.issuer_name ?? null).toBe(seededIssuerName);
      expect(after?.sic_code ?? null).toBe(seededSicCode);
    });
  });
});

/**
 * Same gap as Form 1-K: `item1.phone` sits beside the address the storage
 * already saved, and went unread. 1,696 Form 1-Z company observations, none
 * with a phone.
 */
describe("Form 1-Z issuer phone", () => {
  let phoneRepo: PhoneRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    phoneRepo = new PhoneRepo();
  });

  it("stores item1.phone and hands it to the issuer observation", async () => {
    const mockDataDir = join(__dirname, "mock_data", "form-1-z");
    const file = readdirSync(mockDataDir).filter((f) => f.endsWith(".xml"))[0]!;
    const form1Z = await Form_1_Z.parse("1-Z", readFileSync(join(mockDataDir, file), "utf-8"));
    const raw = form1Z.formData.item1.phone;
    expect(raw).toBeTruthy();

    const cik = parseInt(form1Z.headerData.filerInfo.filer.issuerCredentials.cik);
    await processForm1Z({
      cik,
      file_number: "024-33333",
      accession_number: "test-accession-1z-phone",
      filing_date: "2024-09-15",
      primary_doc: file,
      form1Z,
    });

    const stored = ((await phoneRepo.phoneRepository.getAll()) ?? []).find(
      (row) => row.raw_phone === raw
    );
    expect(stored).toBeDefined();

    const junction =
      (await phoneRepo.phoneEntityJunctionRepository.query({
        international_number: stored!.international_number,
      })) ?? [];
    expect(
      junction.some((j) => Number(j.cik) === cik && j.relation_name === "entity:contact")
    ).toBe(true);

    const observations = await new CompanyObservationRepo().listAll();
    expect(
      observations.some(
        (o) => o.accession_number === "test-accession-1z-phone" && o.raw_phone_id !== null
      )
    ).toBe(true);
  });
});
