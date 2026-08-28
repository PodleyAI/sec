/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { AddressRepo } from "../../../storage/address/AddressRepo";
import { PhoneRepo } from "../../../storage/phone/PhoneRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { RegAOfferingRepo } from "../../../storage/reg-a/RegAOfferingRepo";
import { Form_1_K } from "./Form_1_K";
import { processForm1K } from "./Form_1_K.storage";

describe("Form_1_K storage test", () => {
  let addressRepo: AddressRepo;
  let regARepo: RegAOfferingRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    addressRepo = new AddressRepo();
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
          const parsed = await Form_1_K.parse("1-K", xmlContent);
          const form1K = parsed.cover;
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
            form: "1-K",
            form1K: parsed,
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

      // Verify companies were stored via observation tier
      const allCompanies = await new CompanyObservationRepo().listAll();
      expect(allCompanies.length).toBeGreaterThan(0);
    });

    it("should store offering history with correct data", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const parsed = await Form_1_K.parse("1-K", xmlContent);
      const form1K = parsed.cover;
      const primaryIssuer = form1K.formData.item1Info[0];
      const cik = primaryIssuer?.cik ? parseInt(primaryIssuer.cik) : 12345;
      const fileNumber = "024-test-001";

      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: "test-accession-1k",
        filing_date: "2024-06-15",
        primary_doc: xmlFiles[0],
        form: "1-K",
        form1K: parsed,
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
        const parsed = await Form_1_K.parse("1-K", xmlContent);
        const form1K = parsed.cover;

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
            form: "1-K",
            form1K: parsed,
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

    it("should store issuer address from item1", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const parsed = await Form_1_K.parse("1-K", xmlContent);
      const form1K = parsed.cover;
      const primaryIssuer = form1K.formData.item1Info[0];
      const cik = primaryIssuer?.cik ? parseInt(primaryIssuer.cik) : 12345;

      await processForm1K({
        cik,
        file_number: "024-addr-test",
        accession_number: "test-addr-accession",
        filing_date: "2024-06-15",
        primary_doc: xmlFiles[0],
        form: "1-K",
        form1K: parsed,
      });

      const allAddresses = (await addressRepo.addressRepository.getAll()) || [];
      expect(allAddresses.length).toBeGreaterThan(0);
    });

    // Plan H regression guard: whitespace / empty pricePerSecurity must
    // not appear as 0 in offering_history; legitimate "0" must round-trip.

    it("treats whitespace-only pricePerSecurity as null (not fabricated 0)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const parsed = await Form_1_K.parse("1-K", xmlContent);
      const form1K = parsed.cover;
      if (!form1K.formData.summaryInfo?.[0]) return; // schema-optional
      (form1K.formData.summaryInfo[0] as Record<string, unknown>).pricePerSecurity = "   ";

      const cik = 990001;
      const fileNumber = "024-h-ws-k";
      const accessionNumber = "test-h-ws-k";
      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-06-15",
        primary_doc: xmlFiles[0],
        form: "1-K",
        form1K: parsed,
      });
      const offeringFileNumber = form1K.formData.summaryInfo[0].commissionFileNumber ?? fileNumber;
      const history = await regARepo.offeringHistoryRepository.get({
        cik,
        file_number: offeringFileNumber,
        accession_number: accessionNumber,
      });
      expect(history?.price_per_security).toBe(null);
    });

    it("treats empty pricePerSecurity as null (not fabricated 0)", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const parsed = await Form_1_K.parse("1-K", xmlContent);
      const form1K = parsed.cover;
      if (!form1K.formData.summaryInfo?.[0]) return;
      (form1K.formData.summaryInfo[0] as Record<string, unknown>).pricePerSecurity = "";

      const cik = 990002;
      const fileNumber = "024-h-empty-k";
      const accessionNumber = "test-h-empty-k";
      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-06-15",
        primary_doc: xmlFiles[0],
        form: "1-K",
        form1K: parsed,
      });
      const offeringFileNumber = form1K.formData.summaryInfo[0].commissionFileNumber ?? fileNumber;
      const history = await regARepo.offeringHistoryRepository.get({
        cik,
        file_number: offeringFileNumber,
        accession_number: accessionNumber,
      });
      expect(history?.price_per_security).toBe(null);
    });

    it("preserves a legitimate '0' pricePerSecurity as DB value 0", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");

      const parsed = await Form_1_K.parse("1-K", xmlContent);
      const form1K = parsed.cover;
      if (!form1K.formData.summaryInfo?.[0]) return;
      (form1K.formData.summaryInfo[0] as Record<string, unknown>).pricePerSecurity = "0";

      const cik = 990003;
      const fileNumber = "024-h-zero-k";
      const accessionNumber = "test-h-zero-k";
      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: accessionNumber,
        filing_date: "2024-06-15",
        primary_doc: xmlFiles[0],
        form: "1-K",
        form1K: parsed,
      });
      const offeringFileNumber = form1K.formData.summaryInfo[0].commissionFileNumber ?? fileNumber;
      const history = await regARepo.offeringHistoryRepository.get({
        cik,
        file_number: offeringFileNumber,
        accession_number: accessionNumber,
      });
      expect(history?.price_per_security).toBe(0);
    });

    it("undated stale replay does not regress a dated mutable row", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-1-k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const xmlContent = readFileSync(join(mockDataDir, xmlFiles[0]), "utf-8");
      const parsed = await Form_1_K.parse("1-K", xmlContent);
      const form1K = parsed.cover;
      const cik = 990010;
      const fileNumber = "024-1k-und";

      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: "1k-dated-seed",
        filing_date: "2024-06-15",
        primary_doc: xmlFiles[0],
        form: "1-K",
        form1K: parsed,
      });

      const seeded = await regARepo.getOffering(cik, fileNumber);
      expect(seeded?.as_of).toBe("2024-06-15");
      const seededTier = seeded?.tier ?? null;
      const seededIssuerName = seeded?.issuer_name ?? null;
      const seededSicCode = seeded?.sic_code ?? null;

      // Undated replay (filer error). Any dated row must win.
      await processForm1K({
        cik,
        file_number: fileNumber,
        accession_number: "1k-undated-replay",
        filing_date: "",
        primary_doc: xmlFiles[0],
        form: "1-K",
        form1K: parsed,
      });

      const after = await regARepo.getOffering(cik, fileNumber);
      expect(after?.as_of).toBe("2024-06-15");
      expect(after?.tier ?? null).toBe(seededTier);
      expect(after?.issuer_name ?? null).toBe(seededIssuerName);
      expect(after?.sic_code ?? null).toBe(seededSicCode);
    });
  });
});

/**
 * The issuer's phone rides along with the issuer's address.
 *
 * Both come out of the same `item1` block, and for a long time only the
 * address was read — so every Form 1-K company observation carried a null
 * phone while the number sat unread one field away. The tell was in the data:
 * 5,383 1-K observations, zero with a phone.
 */
describe("Form 1-K issuer phone", () => {
  let phoneRepo: PhoneRepo;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    phoneRepo = new PhoneRepo();
  });

  it("stores item1.phoneNumber and hands it to the issuer observation", async () => {
    const mockDataDir = join(__dirname, "mock_data", "form-1-k");
    const file = readdirSync(mockDataDir).filter((f) => f.endsWith(".xml"))[0]!;
    const parsed = await Form_1_K.parse("1-K", readFileSync(join(mockDataDir, file), "utf-8"));
    const form1K = parsed.cover;
    const raw = form1K.formData.item1.phoneNumber;
    expect(raw).toBeTruthy();

    const cik = parseInt(form1K.formData.item1Info[0]!.cik!);
    await processForm1K({
      cik,
      file_number: "024-11111",
      accession_number: "test-accession-1k-phone",
      filing_date: "2024-06-15",
      primary_doc: file,
      form: "1-K",
      form1K: parsed,
    });

    const phones = (await phoneRepo.phoneRepository.getAll()) ?? [];
    expect(phones.length).toBeGreaterThan(0);
    const stored = phones.find((row) => row.raw_phone === raw);
    expect(stored).toBeDefined();

    // Junctioned to the filer, and carried onto the observation the identity
    // tier reads — storing the row alone would leave both still empty.
    const junction =
      (await phoneRepo.phoneEntityJunctionRepository.query({
        international_number: stored!.international_number,
      })) ?? [];
    expect(
      junction.some((j) => Number(j.cik) === cik && j.relation_name === "entity:contact")
    ).toBe(true);

    const observations = await new CompanyObservationRepo().listAll();
    const issuerObs = observations.filter(
      (o) => o.accession_number === "test-accession-1k-phone" && o.raw_phone_id !== null
    );
    expect(issuerObs.length).toBeGreaterThan(0);
  });

  it("does not store the EDGAR submission contact phone", async () => {
    // The contact block lives in headerData.filerInfo, beside `liveTestFlag`
    // and `notifications` — it is the EDGAR transmission contact (a filing
    // agent or attorney), not the issuer. Form 1-A and Form D make the same
    // split; storing it would attribute a law firm's switchboard to the
    // company.
    const mockDataDir = join(__dirname, "mock_data", "form-1-k");
    const files = readdirSync(mockDataDir).filter((f) => f.endsWith(".xml"));
    for (const file of files) {
      const parsed = await Form_1_K.parse("1-K", readFileSync(join(mockDataDir, file), "utf-8"));
      const form1K = parsed.cover;
      const contactPhone = form1K.headerData.filerInfo.contact?.contactPhone;
      if (!contactPhone || contactPhone === form1K.formData.item1.phoneNumber) continue;
      await processForm1K({
        cik: parseInt(form1K.formData.item1Info[0]!.cik!),
        file_number: "024-22222",
        accession_number: `test-1k-contact-${file}`,
        filing_date: "2024-06-15",
        primary_doc: file,
        form: "1-K",
        form1K: parsed,
      });
      const phones = (await phoneRepo.phoneRepository.getAll()) ?? [];
      expect(phones.some((row) => row.raw_phone === contactPhone)).toBe(false);
      return;
    }
  });
});
